// Employee records for the Onboarding & Milestones module.
// GET    -> role-scoped list (Operations sees preference fields only; Disney Lead sees Disney only)
// PATCH  -> edit a record (permission checks per field in employees.js)
// POST   -> { action: 'approve_joining_date' | 'reject_joining_date', id }
// DELETE -> { id } (Super Admin only)
import { db, must } from '../supabase.js'
import { requireStaff } from '../auth.js'
import { clean, HttpError, methodNotAllowed, fail } from '../env.js'
import { can, isInRoleScope, projectForRole } from '../permissions.js'
import { decideJoiningDate, updateEmployeeAsStaff, audit } from '../employees.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireId(value) {
  const id = clean(value)
  if (!UUID_RE.test(id)) throw new HttpError(400, 'A valid employee id is required.')
  return id
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { staff } = await requireStaff(req, 'employees:read_prefs')
      const rows = must(await db().from('ksc_employees').select('*').order('full_name', { ascending: true }), 'Could not load employees')
      let visible = rows.filter((row) => isInRoleScope(staff.role, row))
      if (!can(staff.role, 'employees:read_full')) visible = visible.filter((row) => row.status === 'active')
      return res.status(200).json({
        employees: visible.map((row) => projectForRole(staff.role, row)),
        scope: staff.role === 'disney_lead' ? 'disney' : 'all',
      })
    }

    if (req.method === 'PATCH') {
      const { email, staff } = await requireStaff(req, 'employees:edit')
      const id = requireId(req.body?.id)
      const updated = await updateEmployeeAsStaff({ ...staff, email }, id, req.body || {})
      return res.status(200).json({ success: true, employee: projectForRole(staff.role, updated) })
    }

    if (req.method === 'POST') {
      const { email, staff } = await requireStaff(req, 'joining_date:approve')
      const id = requireId(req.body?.id)
      const decision = req.body?.action === 'approve_joining_date' ? 'approve' : req.body?.action === 'reject_joining_date' ? 'reject' : null
      if (!decision) throw new HttpError(400, 'Unknown action.')
      const existing = must(await db().from('ksc_employees').select('employee_type').eq('id', id).maybeSingle(), 'Could not load employee')
      if (!existing) throw new HttpError(404, 'Employee not found.')
      if (!isInRoleScope(staff.role, existing)) throw new HttpError(403, 'You can only manage Disney employees.')
      const employee = await decideJoiningDate(id, decision, email)
      return res.status(200).json({ success: true, employee: projectForRole(staff.role, employee) })
    }

    if (req.method === 'DELETE') {
      const { email } = await requireStaff(req, 'employees:delete')
      const id = requireId(req.body?.id)
      await audit(email, 'employee.deleted', id)
      must(await db().from('ksc_employees').delete().eq('id', id), 'Could not delete employee')
      return res.status(200).json({ success: true })
    }

    return methodNotAllowed(res)
  } catch (error) {
    return fail(res, error, 'Employees API error')
  }
}
