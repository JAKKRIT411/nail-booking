export function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect("/admin-login.html");
  }
  next();
}