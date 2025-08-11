exports.requestLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(2, 9);
  console.log(`[${new Date().toISOString()}] [Request ${requestId}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length) {
    try { console.log(`[Request ${requestId}] Body:`, JSON.stringify(req.body, null, 2)); } catch {}
  }
  const oldSend = res.send;
  res.send = function (data) {
    console.log(`[${new Date().toISOString()}] [Response ${requestId}] ${req.method} ${req.url} - Status: ${res.statusCode}, Duration: ${Date.now() - start}ms`);
    try {
      console.log(`[Response ${requestId}] Data:`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    } catch {}
    oldSend.apply(res, arguments);
  };
  next();
};
