(function () {
  var preference = "system";
  try {
    var saved = localStorage.getItem("airsense.theme");
    if (saved === "light" || saved === "dark" || saved === "system") preference = saved;
  } catch (_) {
    // Use the system preference when storage is unavailable.
  }
  var dark = preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var resolved = dark ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", dark ? "#101722" : "#F4F6F9");
})();
