// Aplica los system insets (status bar, nav bar, display cutout) al CSS.
// MainActivity expone window.AndroidInsets via JavascriptInterface. Esto es
// necesario porque env(safe-area-inset-*) no funciona en WebView de Android 15.
(function () {
  if (typeof window === 'undefined') return;

  function apply() {
    var ai = window.AndroidInsets;
    if (!ai) return;
    var root = document.documentElement;
    if (!root) return;
    try {
      root.style.setProperty('--sai-top', ai.getTop() + 'px');
      root.style.setProperty('--sai-bottom', ai.getBottom() + 'px');
      root.style.setProperty('--sai-left', ai.getLeft() + 'px');
      root.style.setProperty('--sai-right', ai.getRight() + 'px');
    } catch (e) {}
  }

  // Apply now and on every relevant event. AndroidInsets puede no existir aún
  // (web normal): noop. Si existe, aplicamos repetidamente para cubrir el caso
  // de que MainActivity reciba los insets reales después de DOMContentLoaded.
  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  }
  window.addEventListener('load', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', function () {
    setTimeout(apply, 100);
  });
})();
