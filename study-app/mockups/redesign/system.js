/* ============================================================
   日常日本語 · SHARED THEME MACHINERY + POLISH
   Drives every surface. All content is visible without JS — this
   only adds theming, press feedback, and the entrance flourish.
   ============================================================ */
(function () {
  "use strict";

  var root = document.documentElement;

  /* ---- set theme ASAP (before paint) to avoid a flash ----
     ?theme=dark|light wins; otherwise default to light.       */
  function initTheme() {
    var qs = null;
    try {
      qs = new URLSearchParams(location.search).get("theme");
    } catch (e) {}
    var theme = qs === "dark" || qs === "light" ? qs : "light";
    root.setAttribute("data-theme", theme);
  }
  initTheme();

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    /* ---- theme toggle (☼ light ⇄ ☾ night) ---- */
    var toggle = document.getElementById("themeToggle");
    if (toggle) {
      var sync = function () {
        var dark = root.getAttribute("data-theme") === "dark";
        toggle.setAttribute("title", dark ? "Switch to day" : "Switch to night");
        toggle.setAttribute(
          "aria-label",
          dark ? "Switch to day theme" : "Switch to night theme"
        );
      };
      sync();
      toggle.addEventListener("click", function () {
        var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        sync();
      });
    }

    /* ---- tasteful press feedback on tactile controls ----
       (CSS handles hover/active scale too; this is a small extra
       for pointer devices and never hides content)              */
    var tactile = document.querySelectorAll(
      ".grade, .btn, .pill, .chip, .play-btn, .tool-btn, .icon-btn"
    );
    tactile.forEach(function (el) {
      var press = function () {
        el.style.transform = "translateY(1px) scale(.99)";
      };
      var release = function () {
        el.style.transform = "";
      };
      el.addEventListener("pointerdown", press);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointerleave", release);
      el.addEventListener("pointercancel", release);
    });

    /* ---- entrance polish ----
       Plain .reveal elements animate via CSS on their own, so the
       page reveals even with JS off. For any .reveal.needs-js
       element (kept hidden in CSS until JS runs) we add .in with a
       small stagger. Honors reduced-motion by skipping straight in. */
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var staged = document.querySelectorAll(".reveal.needs-js");
    staged.forEach(function (el, i) {
      if (reduce) {
        el.classList.add("in");
        return;
      }
      setTimeout(function () {
        el.classList.add("in");
      }, 60 + i * 70);
    });
  });
})();
