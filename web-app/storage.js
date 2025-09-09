// Helpers de almacenamiento local (sesión)
(function () {
  const LS_USER = "checkedin:user";
  function getJSON(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
  function setJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  window.CheckedInStorage = {
    getUser: () => getJSON(LS_USER),
    setUser: (u) => setJSON(LS_USER, u),
    removeUser: () => localStorage.removeItem(LS_USER),
  };
  console.log("[storage] listo");
})();
