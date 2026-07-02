// Pure helpers for append-only audit events.
const Audit = (() => {
  const ACTIONS = [
    'request.approve',
    'request.reject',
    'agent.create',
    'agent.update',
    'agent.activate',
    'agent.deactivate',
    'agent.delete',
    'roofConfig.update',
  ];
  const TARGET_TYPES = ['request', 'agent', 'roofConfig', 'settlementOverride'];

  function buildEvent(actor, action, targetType, targetId, details, now) {
    if (!actor || !actor.id) throw new Error('actor required');
    if (!ACTIONS.includes(action)) throw new Error('invalid audit action');
    if (!TARGET_TYPES.includes(targetType)) throw new Error('invalid audit targetType');
    if (actor.role !== 'lead' && actor.role !== 'manager') throw new Error('invalid audit actor role');
    return {
      action,
      targetType,
      targetId: targetId || '',
      actorId: actor.id || '',
      actorName: actor.name || '',
      actorRole: actor.role || '',
      details: details || {},
      createdAt: now || Date.now(),
    };
  }

  return { ACTIONS, TARGET_TYPES, buildEvent };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Audit;
if (typeof window !== 'undefined') window.Audit = Audit;
