exports.errorHandler = (err, req, res, next) => {
  console.error('[Server] Erreur non gérée:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  res.status(500).json({ error: 'Erreur serveur: ' + err.message });
};
