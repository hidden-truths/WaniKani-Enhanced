# ADR-001: No Kubernetes (and no DOKS) for wk-enhanced-api

- **Status:** Accepted, 2026-05-25.
- **Authors:** wk-enhanced-api maintainer.
- **Supersedes:** none.

## Context

The question of "why aren't you using Kubernetes / DigitalOcean Kubernetes Service (DOKS) for this?" comes up periodically — from contributors evaluating the deploy, from anyone surveying the cost line, and occasionally from the maintainer themselves when a deploy day is tedious. Recording the analysis once lets everyone stop relitigating it.

`wk-enhanced-api` runs as one Bun process on a single $6/mo DigitalOcean droplet (SFO3), with media in DO Spaces ($5/mo) and Cloudflare Tunnel (free) handling TLS + edge cache. The deploy mechanism is bare-metal systemd: a service unit + monthly warm timer + daily backup timer, all under [`wk-enhanced-api/deploy/`](../../deploy/). SQLite lives at `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` and survives `git pull` in `/opt/wk-enhanced-api`.

Total steady-state spend: **≈$11/mo**.

## Decision

**We do not use Kubernetes.** Specifically: we do not run on DOKS, GKE, EKS, or any self-managed k8s; we don't write Helm charts; we don't produce manifests. The unit of deploy is the droplet + the systemd unit, full stop.

We *do* leave the door open to Docker-ize the server later (tracked in `NEW_FEATURES.md` under "Dockerize the server") for operational hygiene — but the target remains `docker compose up` on a single droplet, not orchestration across many.

## Why — the analysis

### Cost: K8s starts at 4× our current bill

- **DOKS minimum cost:** $12/mo control plane + $12/mo for one worker node = **$24/mo**.
- **Today:** $6/mo droplet + $5/mo Spaces = **$11/mo**.
- That's a 2× to 4× increase for the same workload. K8s buys nothing for that delta unless we're using features we don't need.

### Workload doesn't match what K8s is for

K8s shines when you have:

- Multiple services that need to coordinate.
- Variable load that benefits from autoscaling.
- Many instances of one service that need rolling deploys.
- Cross-zone or cross-cluster failover.

We have:

- **One service.** One Bun process serving one HTTP API.
- **Bounded traffic.** Low thousands of users, monthly bulk warm + on-demand lazy fill. No spike pattern that needs HPA.
- **No need for instance redundancy.** Cold-fill latency is the ceiling; an extra instance doesn't reduce it.
- **No multi-zone story.** One droplet in SFO3 is fine for a single-region userbase whose primary latency comes from upstream IK calls, not from our last-mile.

None of K8s's strengths apply to this shape.

### Stateful workloads on K8s are awkward

Our DB is SQLite on the local filesystem. On K8s that means either:

- **PersistentVolumeClaim:** introduces a separate storage layer we'd need to provision, monitor, and pay for. On DOKS that's a DigitalOcean Block Storage volume (\$0.10/GB-month, minimum 10GB = $1/mo extra). It also locks the pod to a specific node, which fights the whole "pods are fungible" idea k8s is selling.
- **HostPath mounts:** explicitly discouraged in k8s docs for production. Effectively the same as a droplet at that point.
- **Migrate to Postgres:** the original SERVER_DESIGN.md plan. Decided against (see `wk-enhanced-api/CLAUDE.md` DEAD-END WARNINGS). Adds another managed service (\$15/mo on DO) and the data model genuinely doesn't need it.

A single droplet's filesystem is the right abstraction for a single SQLite DB. K8s adds layers without solving a problem we have.

### Pod eviction is a feature for stateless services and a hazard for stateful ones

K8s schedulers reschedule pods routinely: node maintenance, version upgrades, resource pressure, pod-disruption budgets, autoscaler decisions. For stateless services that's a feature — the next pod comes up elsewhere with no state to carry.

For a stateful service with a local DB, a reschedule means tearing down and restarting against new storage. Droplet stability — same VM, same disk, indefinite uptime barring host failure — is genuinely better for this shape.

### Operational complexity

Even a minimum-viable k8s deploy involves Ingress, Service, ConfigMap, Secret, Deployment, PersistentVolumeClaim, and HorizontalPodAutoscaler manifests. Plus understanding selectors, labels, namespaces, RBAC, and the kubectl ergonomics for each. That's ~10 manifest types and a non-trivial mental model.

Our current deploy is: copy four systemd unit files, fill in one env file, `systemctl enable --now`. Five things, one file format. The k8s version of the same deploy doesn't earn its operational cost.

## Consequences

### Things we accept

- **Single point of failure.** If the droplet dies, the API is down until we provision a new one and restore the latest SQLite backup. Recovery time is bounded by the deploy walkthrough (~30 min today, ~5 min after Docker-izing). Acceptable for this service.
- **No zero-downtime deploys.** `systemctl restart wk-enhanced-api` drops in-flight requests. The typical request is sub-100ms so the window is tiny, and our clients (the userscript) retry naturally on next render. Not worth the complexity to fix.
- **No autoscaling.** If traffic grows past what one droplet handles, we manually upsize ($6 → $12 → $24 vertically before needing a second droplet). The vertical headroom is plenty for the bounded-userbase scale we expect.
- **Bun + systemd as the deploy unit.** Contributors who only know k8s have to learn one new thing. Acceptable — the systemd unit fits on a printed page and is documented in `deploy/README.md`.

### Things we get

- **$11/mo all-in,** which is cheap enough to run out of pocket without a billing model.
- **Boring deploys.** No CRD churn, no cluster upgrade Tuesdays, no PodSecurityPolicy → PodSecurity migration to schedule.
- **Easy local-equivalent dev.** `bun dev` against `STORAGE_DRIVER=local` produces the same behavior as prod. No `minikube` / `kind` / `tilt` to learn.
- **One log stream.** `journalctl -fu wk-enhanced-api` shows everything. Compare to k8s where the same investigation needs `kubectl logs --previous` + `kubectl describe pod` + `kubectl get events`.

## When this decision should be revisited

Reopen this ADR if **any** of the following becomes true:

- We grow to **more than one service.** Coordinating two Bun processes via systemd is fine; coordinating five starts to feel like reinventing orchestration.
- We need **zero-downtime rolling deploys** under load (currently irrelevant — userscript clients are forgiving).
- We need **multi-region failover** to keep latency under some SLA (currently uninteresting — IK latency dominates).
- The user base grows past **what vertical scaling on one droplet can handle** ($24/mo + $5 Spaces = $29/mo, ~8GB RAM, 4 vCPU, ~80GB SSD — generous headroom against the actual workload).

Until then, **single Bun process on a single droplet** is the right shape.

## See also

- `NEW_FEATURES.md` → "Dockerize the server" — the next architectural step that *is* worth doing, scoped to operational hygiene rather than platform migration.
- `wk-enhanced-api/CLAUDE.md` "Things that look like bugs but aren't" → "SQLite is the DB even in production" — companion decision; the K8s and Postgres questions are entangled, both rejected for the same reason.
- `wk-enhanced-api/deploy/README.md` — the bare-metal-systemd deploy walkthrough this ADR is implicitly defending.
