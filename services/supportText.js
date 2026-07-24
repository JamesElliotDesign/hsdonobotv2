function describePriorityQueue(pq, phase = 'pending') {
  const completed = phase === 'completed';

  switch (pq?.kind) {
    case 'thirty_days':
      return completed
        ? '30 days of Priority Queue added'
        : '30 days of Priority Queue will be added';
    case 'one_year':
      return completed
        ? 'Priority Queue extended to at least 1 year'
        : 'Priority Queue will be extended to at least 1 year';
    case 'lifetime':
      return completed
        ? 'Lifetime Priority Queue unlocked'
        : 'Lifetime Priority Queue will be unlocked';
    case 'already_unlimited':
      return 'Lifetime Priority Queue is already active';
    case 'none':
      return 'No Priority Queue included for an individual purchase below £20';
    default:
      return 'Priority Queue outcome not recorded';
  }
}

function priorityQueueReceiptDescription(pq) {
  switch (pq?.kind) {
    case 'thirty_days':
      return '30 days of Priority Queue added';
    case 'one_year':
      return 'Priority Queue extended to at least 1 year';
    case 'lifetime':
      return 'Lifetime Priority Queue unlocked';
    case 'already_unlimited':
      return 'Lifetime Priority Queue was already active';
    case 'none':
      return 'No Priority Queue included for this individual purchase';
    default:
      return 'Priority Queue outcome not recorded';
  }
}

function formatReceiptMoney(valuePence, currency = 'GBP') {
  return `${currency || 'GBP'} ${(Number(valuePence || 0) / 100).toFixed(2)}`;
}

module.exports = {
  describePriorityQueue,
  priorityQueueReceiptDescription,
  formatReceiptMoney,
};
