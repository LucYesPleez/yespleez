/**
 * WHICH ROLE CARDS AN ACCOUNT MAY SEE.
 *
 * The role list is defined once (RoleSelectorScreen's ROLES) and read by TWO
 * surfaces — the /role-select picker and IndustryPanel's switcher. A card that
 * is meant to be restricted has to be filtered in both, so the filter lives
 * here rather than being written twice and drifting.
 *
 * ⚠ THIS IS A VISIBILITY GATE, NOT AN AUTHORIZATION BOUNDARY, and the
 * difference matters. The allowed address ships in the JavaScript bundle, so
 * anyone who opens devtools can read it and render the card for themselves —
 * and nothing here stops a determined person opening the Portal URL directly.
 * It hides work-in-progress from other users; it does not protect anything. The
 * moment a restricted role can DO something that matters, the real check has to
 * be server-side, in RLS, exactly as [[project_role_discovery_scope]] requires
 * for discovery.
 */

/**
 * @param {Array<{restrictedToEmail?: string}>} roles
 * @param {{user?: {email?: string}}|null} session
 * @returns {Array} roles the signed-in account may see, in the order given
 */
export function visibleRoles(roles, session) {
  const email = normalise(session?.user?.email);
  return (roles || []).filter(role => {
    if (!role?.restrictedToEmail) return true;
    // No session means no match — a guest sees no restricted card. Written as
    // an explicit falsy check rather than relying on '' !== 'someone@…',
    // because the interesting case is the one where BOTH sides are empty.
    if (!email) return false;
    return normalise(role.restrictedToEmail) === email;
  });
}

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}
