/** Where billing is reached, written once. */
export const BILLING_HOST = 'https://billing.example.test';

/** Whether the person signed in is staff, which picks a base below. */
export const isStaff = (): boolean => localStorage.getItem('role') === 'staff';
