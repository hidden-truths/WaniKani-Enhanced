// Decouples the PERSISTENCE layer (store / custom / settings / minna) from the CLOUD
// sync layer. Each save*() calls the matching sync.<blob>() to schedule a debounced
// push; cloud.js registers the real schedulers at init. Until registered — and when
// signed out or offline — they're no-ops, so calling them is always safe.
//
// This replaces the old single-scope `if(typeof scheduleCustomSync==='function')…`
// forward-reference guards: those existed only because app.js was one scope evaluated
// top-to-bottom. As real modules, the persistence side can't see cloud's bindings, so
// the indirection lives here. cloud's own schedulers still self-gate on `account`, so a
// signed-out save() routes here, fires the registered scheduler, and that scheduler
// no-ops — same behavior as before.
// (The `minna` blob isn't here: saveMinna is minna-internal, so minna.js calls its own
// scheduleMinnaSync directly rather than routing through the bus.)
export const sync = {
  progress: () => {},   // the `verbs` blob (state.store) — save()
  custom: () => {},     // the `custom-verbs` blob — saveCustom()
  settings: () => {},   // the `settings` blob — saveSettings()
};
