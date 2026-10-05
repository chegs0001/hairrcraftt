export type Role = 'manager' | 'member'
export type StaffStatus = 'pending' | 'active' | 'inactive'

export interface Branch {
  id: string
  name: string
  code: string
  address: string | null
  lat: number | null
  lng: number | null
  geofence_radius_m: number
}

export interface Staff {
  id: string
  auth_user_id: string | null
  email: string
  name: string
  phone: string | null
  role: Role
  is_admin: boolean
  branch_id: string | null
  status: StaffStatus
  shift_start: string
  shift_end: string
  joined_on: string
  last_working_on: string | null
}

export interface StaffTerms {
  id: string
  staff_id: string
  monthly_salary: number
  weekly_off_day: number
  effective_from: string
}

export interface Client {
  id: string
  phone: string
  name: string
  gender: 'male' | 'female' | 'other' | null
  birthday: string | null
  notes: string | null
}

export interface Category {
  id: string
  name: string
  gender: 'men' | 'women' | 'both'
  sort: number
}

export interface Service {
  id: string
  category_id: string
  name: string
  gender: 'men' | 'women' | 'both'
  standard_price: number | null
  prime_price: number | null
  unit_label: string | null
  price_hint: string | null
  is_package: boolean
  active: boolean
  sort: number
}

export interface LineStaff { staff_id: string; share: number }

export interface VisitLine {
  id: string
  visit_id: string
  kind: 'service' | 'product' | 'membership'
  item_id: string | null
  name: string
  qty: number
  list_price: number
  price: number
  net_price: number | null
  flagged: boolean
  flag_reason: string | null
  status: 'active' | 'removed'
  done_at: string | null
  created_by: string | null
  visit_line_staff: LineStaff[]
}

export interface Visit {
  id: string
  branch_id: string
  client_id: string
  status: 'open' | 'billed' | 'cancelled'
  business_date: string
  created_at: string
  clients: Client
}

export interface Bill {
  id: string
  bill_no: string
  subtotal: number
  discount: number
  membership_fee: number
  previous_due: number
  total_payable: number
  paid: number
  new_due: number
}

export interface PayrollLine {
  id: string; run_id: string; staff_id: string; salary: number; expected_days_full: number; expected_days: number
  day_rate: number; present_days: number; absent_days: number; half_days: number; extra_days: number; leave_days: number
  short_minutes: number; absent_deduction: number; extra_pay: number; short_deduction: number; base_pay: number
  credit: number; salon_sales: number; target: number; incentive: number; advances: number; carry_in: number
  net_pay: number; carry_out: number; makeup_days: number; void: boolean; window_end: string | null; paid_at: string | null; paid_mode: 'cash' | 'upi' | null
}
export interface PayrollRun { id: string; branch_id: string; month: string; status: 'draft' | 'final'; kind: 'monthly' | 'exit'; staff_id: string | null }

export interface Product {
  id: string; name: string; sku: string | null; selling_price: number; prime_price: number | null
  low_stock_at: number; active: boolean
}
export interface StockRow { branch_id: string; product_id: string; name: string; sku: string | null; qty: number; low_at: number; low: boolean }
