import { requireAdmin } from '../../_lib/auth.js';
export const onRequest = requireAdmin;
