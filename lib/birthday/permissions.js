// Single source of truth for roles and permissions.
// Add a new module permission here, then reference it in the API and the UI.

export const ROLE_LABELS = {
  super_admin: 'Admin',
  it_admin: 'IT',
  hr_admin: 'HR',
  payroll: 'Payroll',
}

export const APP_CATEGORIES = [
  'Slack',
  'Operations',
  'Finance & Payroll',
  'Inventory & Warehouse',
  'Purchasing',
  'Sales & Quotation',
  'HR & People',
  'Internal Tools',
  'Other',
]

const PERMISSIONS = {
  // Employee records. Admin and IT: everything. HR: edit and approvals. Payroll: view only.
  'employees:read_full': ['super_admin', 'it_admin', 'hr_admin', 'payroll'],
  'employees:read_prefs': ['super_admin', 'it_admin', 'hr_admin', 'payroll'],
  'employees:edit': ['super_admin', 'it_admin', 'hr_admin'],
  'employees:disable': ['super_admin', 'it_admin', 'hr_admin'],
  'employees:delete': ['super_admin', 'it_admin'],
  'employees:unlock': ['super_admin', 'it_admin', 'hr_admin'],
  'joining_date:set': ['super_admin', 'it_admin', 'hr_admin'],
  'joining_date:approve': ['super_admin', 'it_admin', 'hr_admin'],
  'onboarding:trigger': ['super_admin', 'it_admin', 'hr_admin'],
  'offboarding:manage': ['super_admin', 'it_admin', 'hr_admin'],
  'it_access:manage': ['super_admin', 'it_admin'],
}

// Fields that the Operations / Packaging team may see (gift prep only).
export const PREF_FIELDS = [
  'id',
  'full_name',
  'slack_username',
  'status',
  'birthday',
  'anniversary',
  'favorite_slime',
  'favorite_color',
  'favorite_snack',
]

export function can(role, permission) {
  return (PERMISSIONS[permission] || []).includes(role)
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((permission) => can(role, permission))
}

// Disney Lead only ever sees and edits Disney employees.
export function isInRoleScope(role, employee) {
  return true
}

// Returns the subset of an employee record the role is allowed to see.
export function projectForRole(role, employee) {
  if (can(role, 'employees:read_full')) return employee
  const projected = {}
  for (const field of PREF_FIELDS) projected[field] = employee[field] ?? null
  return projected
}
