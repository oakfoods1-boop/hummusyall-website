// What's on the menu this week, from the operations sheet Plan tab (TOTAL row). An item whose Plan
// column total is 0 is "not available this week". Items without a "plan" column in data/menu.json
// (pita) are always available. If the sheet can't be read, nothing is blocked.
import menu from '../../data/menu.json';
import { getPlan } from './plan.js';

// Returns { source: 'sheet' | 'none', planDate, unavailable: [item ids] }
export async function getAvailability(env, waitUntil) {
  const plan = await getPlan(env, waitUntil);
  if (!plan) return { source: 'none', planDate: '', unavailable: [] };
  const items = [...menu.bowls, ...menu.extras];
  return {
    source: 'sheet',
    planDate: plan.date || '',
    unavailable: items.filter((i) => i.plan && i.plan in plan.totals && !(Number(plan.totals[i.plan]) > 0)).map((i) => i.id),
  };
}
