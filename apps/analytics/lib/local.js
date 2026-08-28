/**
 * LOCAL-ONLY GATE — the same stance Studio takes, stated as a pure
 * predicate so it is testable without a socket.
 *
 * Analytics v2 runs local-first: the service-role key sits in this
 * process's environment and every route refuses non-local callers.
 * When the service is eventually hosted, this gate is REPLACED by real
 * authentication — it is a placeholder for auth, not a form of it, and
 * nothing else in the codebase may treat "local" as an identity.
 */

/** Is this remote address the local machine? */
export function isLocalAddress(remoteAddress) {
  if (typeof remoteAddress !== 'string' || remoteAddress === '') return false;
  // Express reports IPv4-mapped IPv6 for local IPv4 connections.
  const addr = remoteAddress.startsWith('::ffff:')
    ? remoteAddress.slice('::ffff:'.length)
    : remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost';
}

/** Express middleware: 403 for anything that is not this machine. */
export function requireLocal(req, res, next) {
  if (!isLocalAddress(req.socket?.remoteAddress ?? '')) {
    return res.status(403).json({ error: 'Analytics is available on this machine only.' });
  }
  next();
}
