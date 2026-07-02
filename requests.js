// Pure logic for exception requests. No DOM, no Firebase — unit-testable in Node.
const Requests = (() => {
  function normalizeName(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/['"״׳]/g, '')
      .replace(/[-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // overrides: { [normalizedName]: { status, note, updatedBy, updatedAt } }
  function mergeOverrides(settlements, overrides) {
    if (!overrides) return settlements;
    return settlements.map(s => {
      const ov = overrides[normalizeName(s.name)];
      if (!ov) return s;
      return Object.assign({}, s, {
        status: ov.status != null ? ov.status : s.status,
        note: ov.note != null ? ov.note : s.note,
        overridden: true,
      });
    });
  }

  // The status a settlement request may ask to switch to.
  const REQUESTABLE_STATUSES = ['מתקינים', 'לא מתקינים'];

  function buildRequest({ type, agent, subject, reason, context, requestedStatus }) {
    if (!agent || !agent.id) throw new Error('agent required');
    if (!reason || !reason.trim()) throw new Error('reason required');
    if (type !== 'settlement' && type !== 'roof') throw new Error('invalid type');
    if (type === 'settlement' && !REQUESTABLE_STATUSES.includes(requestedStatus)) {
      throw new Error('invalid requestedStatus');
    }
    return {
      type,
      agentId: agent.id,
      agentName: agent.name || '',
      subject: subject || '',
      reason: reason.trim(),
      requestedStatus: type === 'settlement' ? requestedStatus : null,
      context: context || {},
      status: 'pending',
      resolution: null,
      managerNote: '',
      createdAt: Date.now(),
      resolvedAt: null,
    };
  }

  // decision: { action: 'approve'|'reject', resolution?: 'one-off'|'permanent', managerNote? }
  function decideRequest(request, decision) {
    const now = Date.now();
    if (decision.action === 'reject') {
      return { status: 'rejected', resolution: null, managerNote: decision.managerNote || '', resolvedAt: now };
    }
    if (decision.action === 'approve') {
      const resolution = decision.resolution === 'permanent' ? 'permanent' : 'one-off';
      return { status: 'approved', resolution, managerNote: decision.managerNote || '', resolvedAt: now };
    }
    throw new Error('invalid action');
  }

  // For permanent settlement approval, compute the override doc to write.
  // The new status is the one the agent requested (request.requestedStatus).
  function overrideFromApproval(request, managerName) {
    if (request.type !== 'settlement') return null;
    return {
      key: normalizeName(request.subject),
      value: { status: request.requestedStatus, note: request.reason, updatedBy: managerName || '', updatedAt: Date.now() },
    };
  }

  // Badge counts for the agent's "my requests" button.
  // lastSeenTs: when the agent last opened the screen (ms epoch, 0 if never).
  function myRequestsBadge(requests, agentId, lastSeenTs) {
    const seen = lastSeenTs || 0;
    let pending = 0, unseenResolved = 0;
    (requests || []).forEach(r => {
      if (r.agentId !== agentId) return;
      if (r.status === 'pending') pending++;
      else if ((r.resolvedAt || 0) > seen) unseenResolved++;
    });
    return { pending, unseenResolved };
  }

  // Badge counts for the manager/lead "manager panel" button.
  function adminBadge(requests, lastSeenTs) {
    const seen = lastSeenTs || 0;
    let pending = 0, unseenNew = 0;
    (requests || []).forEach(r => {
      if (r.status !== 'pending') return;
      pending++;
      if ((r.createdAt || 0) > seen) unseenNew++;
    });
    return { pending, unseenNew };
  }

  return { normalizeName, mergeOverrides, buildRequest, decideRequest, overrideFromApproval, REQUESTABLE_STATUSES, myRequestsBadge, adminBadge };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Requests;
if (typeof window !== 'undefined') window.Requests = Requests;
