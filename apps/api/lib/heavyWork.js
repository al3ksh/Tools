const DEFAULT_MAX_ACTIVE = 1;

const maxActive = Math.max(1, parseInt(process.env.API_HEAVY_CONCURRENCY || DEFAULT_MAX_ACTIVE, 10));
let active = 0;

function heavyWorkLimit(req, res, next) {
  if (active >= maxActive) {
    res.setHeader('Retry-After', '15');
    return res.status(503).json({ error: 'Server is busy processing another heavy task. Please try again shortly.' });
  }

  active++;
  let released = false;
  function release() {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
  }

  res.on('finish', release);
  res.on('close', release);
  next();
}

module.exports = {
  heavyWorkLimit,
  getHeavyWorkStatus: () => ({ active, maxActive })
};
