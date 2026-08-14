import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Calendar as CalendarIcon, 
  Clock, 
  TrendingUp, 
  Search, 
  Plus, 
  Trash2, 
  Edit, 
  FileSpreadsheet, 
  Coins, 
  AlertCircle, 
  CheckCircle, 
  Copy, 
  ExternalLink,
  ChevronDown,
  UserCheck,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  CircleDollarSign,
  Download,
  Percent,
  Settings,
  X,
  User,
  FileText,
  Printer
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, addDoc, doc, setDoc, query, where, onSnapshot } from 'firebase/firestore';

interface Employee {
  id: string; // e.g. EMP001
  name: string;
  position: string;
  hourlyRate: number;
  baseSalary: number;
  status: string; // Active / Inactive
  phone?: string;
  otCalcType?: 'multiplier' | 'flat';
  otRateValue?: number;
  expectedWorkDays?: number;
  shiftType?: 'shift1' | 'shift2';
}

interface Attendance {
  id: string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeName: string;
  checkIn: string; // HH:MM
  checkOut: string; // HH:MM
  notes?: string;
  totalHoursSheet?: number | null;
  otMinsSheet?: number | null;
  breakMinsSheet?: number | null;
}

interface SalaryAdjustment {
  employeeId: string;
  month: string; // YYYY-MM
  bonus: number;
  deduction: number;
  notes?: string;
}

interface Effort {
  id: string; // e.g. EFF001
  date?: string; // e.g. YYYY-MM-DD or Month
  employeeId: string;
  employeeName: string;
  score: number; // productivity rating/score (e.g. 1-10 or 1-100) or task count
  tasksCount?: number;
  notes?: string;
}

interface LeaveLog {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  type: 'sick' | 'personal' | 'unexcused' | 'annual';
  reason: string;
}

const parseDateToYYYYMMDD = (rawDate: string): string => {
  if (!rawDate) return '';
  let trimmed = rawDate.trim();
  
  // Extract just the date part (e.g., from "01/06/2026 6:59:57" or "2026-06-01T00:00:00")
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx !== -1) {
    trimmed = trimmed.substring(0, spaceIdx);
  }
  const tIdx = trimmed.indexOf('T');
  if (tIdx !== -1) {
    trimmed = trimmed.substring(0, tIdx);
  }
  
  trimmed = trimmed.trim();

  // Pattern A: Check if it is a pure integer serial number (Excel/Sheets serial date, e.g. 46176)
  if (/^\d{5}$/.test(trimmed)) {
    const serial = parseInt(trimmed, 10);
    const dateObj = new Date((serial - 25569) * 86400 * 1000);
    if (!isNaN(dateObj.getTime())) {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // Pattern 1: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Pattern 2: YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(trimmed)) {
    return trimmed.replace(/\//g, '-');
  }
  
  // Pattern 3: DD/MM/YYYY (common in Lao files, e.g., 05/06/2026)
  const dmyMatch1 = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch1) {
    const d = dmyMatch1[1].padStart(2, '0');
    const m = dmyMatch1[2].padStart(2, '0');
    const y = dmyMatch1[3];
    return `${y}-${m}-${d}`;
  }

  // Pattern 4: Date check like DD/MM/YY (e.g., 5/6/26 -> 2026-06-05)
  const dmyMatch2 = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (dmyMatch2) {
    const d = dmyMatch2[1].padStart(2, '0');
    const m = dmyMatch2[2].padStart(2, '0');
    const y = '20' + dmyMatch2[3];
    return `${y}-${m}-${d}`;
  }
  
  // General JS Native Parse Fallback
  try {
    const parsed = Date.parse(trimmed);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (err) {}

  return trimmed;
};

const parseSheetHoursToDecimal = (rawHours: string): number | null => {
  if (!rawHours) return null;
  const trimmed = rawHours.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "in") return null;

  // Check if decimal
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Check HH:MM or HH:MM:SS format
  const parts = trimmed.split(':').map(Number);
  if (parts.length >= 2 && !parts.some(isNaN)) {
    const hours = parts[0];
    const minutes = parts[1];
    const seconds = parts.length > 2 ? parts[2] : 0;
    const decimalHours = hours + (minutes / 60) + (seconds / 3600);
    return Math.round(decimalHours * 100) / 100;
  }

  return null;
};

const DEFAULT_LEAVES: LeaveLog[] = [
  { id: 'LV001', employeeId: 'EMP002', employeeName: 'M. Sone Keobandith (ໂຊນ)', date: '2026-05-15', type: 'sick', reason: 'ເປັນໄຂ້ຫວັດໃຫຍ່ (Fever)' },
  { id: 'LV002', employeeId: 'EMP004', employeeName: 'M. Souphaphone Phommasane (ສຸພາພອນ)', date: '2026-05-18', type: 'personal', reason: 'ມີທຸລະຄອບຄົວ (Family event)' }
];

const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'EMP001', name: 'M. Anousone Sengdara (ອານຸສອນ)', position: 'Senior Barista', hourlyRate: 35000, baseSalary: 5500000, status: 'Active', phone: '020-55992211', shiftType: 'shift1' },
  { id: 'EMP002', name: 'M. Sone Keobandith (ໂຊນ)', position: 'Junior Barista', hourlyRate: 25000, baseSalary: 4000000, status: 'Active', phone: '020-44118822', shiftType: 'shift1' },
  { id: 'EMP003', name: 'M. Phouthasone Vongsa (ພູທະສອນ)', position: 'Kitchen Lead', hourlyRate: 28000, baseSalary: 4500000, status: 'Active', phone: '020-99887711', shiftType: 'shift1' },
  { id: 'EMP004', name: 'M. Souphaphone Phommasane (ສຸພາພອນ)', position: 'Barista & Cashier', hourlyRate: 24000, baseSalary: 3800000, status: 'Active', phone: '020-22334455', shiftType: 'shift2' }
];

const DEFAULT_ATTENDANCE: Attendance[] = [
  // Today's records or previous records
  { id: 'ATT001', date: '2026-05-30', employeeId: 'EMP001', employeeName: 'M. Anousone Sengdara (ອານຸສອນ)', checkIn: '08:00', checkOut: '17:00', notes: 'Normal shift' },
  { id: 'ATT002', date: '2026-05-30', employeeId: 'EMP002', employeeName: 'M. Sone Keobandith (ໂຊນ)', checkIn: '08:00', checkOut: '18:00', notes: '1 hour overtime' },
  { id: 'ATT003', date: '2026-05-30', employeeId: 'EMP003', employeeName: 'M. Phouthasone Vongsa (ພູທະສອນ)', checkIn: '07:30', checkOut: '18:30', notes: '2 hours overtime (cooking prep)' },
  { id: 'ATT004', date: '2026-05-30', employeeId: 'EMP004', employeeName: 'M. Souphaphone Phommasane (ສຸພາພອນ)', checkIn: '08:00', checkOut: '17:00', notes: 'Normal shift' },
  
  { id: 'ATT005', date: '2026-05-31', employeeId: 'EMP001', employeeName: 'M. Anousone Sengdara (ອານຸສອນ)', checkIn: '08:00', checkOut: '19:00', notes: 'Weekend rush, 2 hrs OT' },
  { id: 'ATT006', date: '2026-05-31', employeeId: 'EMP002', employeeName: 'M. Sone Keobandith (ໂຊນ)', checkIn: '08:30', checkOut: '17:30', notes: 'Normal shift' },
  { id: 'ATT007', date: '2026-05-31', employeeId: 'EMP003', employeeName: 'M. Phouthasone Vongsa (ພູທະສອນ)', checkIn: '08:00', checkOut: '18:30', notes: '1.5 hours Overtime' },
  { id: 'ATT008', date: '2026-05-31', employeeId: 'EMP004', employeeName: 'M. Souphaphone Phommasane (ສຸພາພອນ)', checkIn: '08:00', checkOut: '18:00', notes: 'Stock take, 1 hr OT' }
];

const DEFAULT_EFFORTS: Effort[] = [
  { id: 'EFF001', date: '2026-05-30', employeeId: 'EMP001', employeeName: 'M. Anousone Sengdara (ອານຸສອນ)', score: 9.2, tasksCount: 15, notes: 'Excellent client service & latte art' },
  { id: 'EFF002', date: '2026-05-30', employeeId: 'EMP002', employeeName: 'M. Sone Keobandith (ໂຊນ)', score: 8.5, tasksCount: 12, notes: 'Very helpful during peak rush' },
  { id: 'EFF003', date: '2026-05-30', employeeId: 'EMP003', employeeName: 'M. Phouthasone Vongsa (ພູທະສອນ)', score: 9.5, tasksCount: 22, notes: 'Kitchen efficiency high, prepped all sauces' },
  { id: 'EFF004', date: '2026-05-30', employeeId: 'EMP004', employeeName: 'M. Souphaphone Phommasane (ສຸພາພອນ)', score: 8.8, tasksCount: 14, notes: 'Cash drawer perfectly balanced' },
  
  { id: 'EFF005', date: '2026-05-31', employeeId: 'EMP001', employeeName: 'M. Anousone Sengdara (ອານຸສອນ)', score: 9.8, tasksCount: 18, notes: 'Superb dedication under high weekend sales' },
  { id: 'EFF006', date: '2026-05-31', employeeId: 'EMP002', employeeName: 'M. Sone Keobandith (ໂຊນ)', score: 8.0, tasksCount: 11, notes: 'Good time management' },
  { id: 'EFF007', date: '2026-05-31', employeeId: 'EMP003', employeeName: 'M. Phouthasone Vongsa (ພູທະສອນ)', score: 9.0, tasksCount: 20, notes: 'Fast response and preparation speed' },
  { id: 'EFF008', date: '2026-05-31', employeeId: 'EMP004', employeeName: 'M. Souphaphone Phommasane (ສຸພາພອນ)', score: 9.2, tasksCount: 16, notes: 'Active customer interaction' }
];


const mergeOverrides = (list: Employee[], overrides: Record<string, Partial<Employee>>): Employee[] => {
  return list.map(emp => {
    let ov = overrides[emp.id];
    
    // Fallback: match by employee name (trimmed, case-insensitive)
    if (!ov) {
      const empNameNorm = emp.name.trim().toLowerCase();
      const matchedKey = Object.keys(overrides).find(key => {
        const o = overrides[key];
        return o && o.name && o.name.trim().toLowerCase() === empNameNorm;
      });
      if (matchedKey) {
        ov = overrides[matchedKey];
      }
    }

    if (ov) {
      return { ...emp, ...ov };
    }
    return emp;
  });
};

export const getExpectedWorkDaysForMonth = (monthStr: string): number => {
  const [year, month] = monthStr.split('-').map(Number);
  if (!year || !month) return 26;
  const numDays = new Date(year, month, 0).getDate();
  let workdays = 0;
  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d);
    const dayOfWeek = date.getDay(); // 0 is Sunday
    if (dayOfWeek !== 0) { // Not Sunday
      workdays++;
    }
  }
  return workdays;
};

export default function HR({ selectedBranch, userSettings }: { selectedBranch?: string, userSettings?: any }) {
  const { i18n } = useTranslation();
  const isLao = i18n.language === 'la';

  // Keep track of user's custom overrides for baseSalary, hourlyRate, expectedWorkDays, otCalcType, and otRateValue
  const [employeeOverrides, setEmployeeOverrides] = useState<Record<string, Partial<Employee>>>(() => {
    const saved = localStorage.getItem('hr_employee_overrides');
    return saved ? JSON.parse(saved) : {};
  });

  // Core records lists with local storage persistence
  const [employees, setEmployees] = useState<Employee[]>(() => {
    const saved = localStorage.getItem('hr_employees');
    const baseList = saved ? JSON.parse(saved) : DEFAULT_EMPLOYEES;
    const savedOverrides = localStorage.getItem('hr_employee_overrides');
    const overrides = savedOverrides ? JSON.parse(savedOverrides) : {};
    return mergeOverrides(baseList, overrides);
  });
  const [attendance, setAttendance] = useState<Attendance[]>(() => {
    const saved = localStorage.getItem('hr_attendance');
    return saved ? JSON.parse(saved) : DEFAULT_ATTENDANCE;
  });
  const [efforts, setEfforts] = useState<Effort[]>(() => {
    const saved = localStorage.getItem('hr_efforts');
    return saved ? JSON.parse(saved) : DEFAULT_EFFORTS;
  });
  const [leaveLogs, setLeaveLogs] = useState<LeaveLog[]>(() => {
    const saved = localStorage.getItem('hr_leave_logs');
    return saved ? JSON.parse(saved) : DEFAULT_LEAVES;
  });

  // Global OT configurations (from local storage)
  const [globalOTRateType, setGlobalOTRateType] = useState<'multiplier' | 'flat'>(() => {
    const savedType = localStorage.getItem('hr_global_ot_rate_type');
    return (savedType === 'flat' ? 'flat' : 'multiplier') as 'multiplier' | 'flat';
  });
  const [globalOTRateValue, setGlobalOTRateValue] = useState<number>(() => {
    const savedVal = localStorage.getItem('hr_global_ot_rate_value');
    return savedVal ? Number(savedVal) : 1.5;
  });

  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'success' | 'warn'>('idle');
  const [syncError, setSyncError] = useState<string>('');
  
  // Date and filter controls
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  });
  const [filterEmployeeId, setFilterEmployeeId] = useState('all');

  // UI Navigation & Interactive Modals
  const [activeSectionTab, setActiveSectionTab] = useState<'payroll' | 'leaves'>('payroll');
  const [selectedEmployeeForProfile, setSelectedEmployeeForProfile] = useState<Employee | null>(null);
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);

  // New Employee entry state
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    id: '', name: '', position: '', hourlyRate: 20000, baseSalary: 3500000, status: 'Active', otCalcType: 'multiplier', otRateValue: 1.5, expectedWorkDays: 26
  });

  // Absence/Leave input state
  const [isAddingLeave, setIsAddingLeave] = useState(false);
  const [newLeave, setNewLeave] = useState<Partial<LeaveLog>>({
    employeeId: '',
    date: new Date().toISOString().split('T')[0],
    type: 'sick',
    reason: ''
  });

  // Attendance logging state
  const [isLoggingAttendance, setIsLoggingAttendance] = useState(false);
  const [newLog, setNewLog] = useState<Partial<Attendance>>({
    date: new Date().toISOString().split('T')[0],
    employeeId: '',
    checkIn: '07:00',
    checkOut: '16:00',
    notes: ''
  });

  // Manual Adjustments (saved in localStorage for persistence)
  const [adjustments, setAdjustments] = useState<Record<string, SalaryAdjustment>>(() => {
    const saved = localStorage.getItem('hr_payroll_adjustments');
    return saved ? JSON.parse(saved) : {};
  });

  // Local storage save triggers
  useEffect(() => {
    localStorage.setItem('hr_employees', JSON.stringify(employees));
  }, [employees]);

  useEffect(() => {
    localStorage.setItem('hr_employee_overrides', JSON.stringify(employeeOverrides));
  }, [employeeOverrides]);

  useEffect(() => {
    localStorage.setItem('hr_attendance', JSON.stringify(attendance));
  }, [attendance]);

  useEffect(() => {
    localStorage.setItem('hr_efforts', JSON.stringify(efforts));
  }, [efforts]);

  useEffect(() => {
    localStorage.setItem('hr_leave_logs', JSON.stringify(leaveLogs));
  }, [leaveLogs]);

  useEffect(() => {
    localStorage.setItem('hr_global_ot_rate_type', globalOTRateType);
  }, [globalOTRateType]);

  useEffect(() => {
    localStorage.setItem('hr_global_ot_rate_value', String(globalOTRateValue));
  }, [globalOTRateValue]);

  useEffect(() => {
    localStorage.setItem('hr_payroll_adjustments', JSON.stringify(adjustments));
  }, [adjustments]);

  // Persistent manual overrides helper to guarantee immediate offline-cache durability on inputs change
  const updateEmployeeOverride = (employeeId: string, field: string, value: any) => {
    setEmployeeOverrides(prev => {
      const updated = { ...prev, [employeeId]: { ...(prev[employeeId] || {}), [field]: value } };
      localStorage.setItem('hr_employee_overrides', JSON.stringify(updated));
      return updated;
    });
  };

  const handleOverrideFieldChange = (field: string, val: any) => {
    if (!selectedEmployeeForProfile) return;
    const empId = selectedEmployeeForProfile.id;
    
    // Update employees list state immediately
    setEmployees(prev => prev.map(emp => emp.id === empId ? { ...emp, [field]: val } : emp));
    
    // Update persistent localStorage overrides to prevent losses on fresh starts/Sheets pull
    updateEmployeeOverride(empId, field, val);
    
    // Smoothly synchronise with the active modal detail view
    setSelectedEmployeeForProfile(p => p ? { ...p, [field]: val } : null);
  };

  // Export payroll ledger report to CSV matching Lao font Excel specifications (UTF-8 BOM)
  const downloadPayrollCSV = () => {
    const BOM = "\uFEFF";
    
    const headers = [
      isLao ? "ລະຫັດພະນັກງານ" : "Employee ID",
      isLao ? "ຊື່ພະນັກງານ" : "Employee Name",
      isLao ? "ຕຳແໜ່ງ" : "Position",
      isLao ? "ວັນເຮັດວຽກຕົວຈິງ" : "Days Worked",
      isLao ? "ວັນເກີນກຳນົດ (ມື້ OT)" : "OT Days",
      isLao ? "ຊົ່ວໂມງການທຳງານ" : "Regular Hours",
      isLao ? "ຊົ່ວໂມງລ່ວງເວລາ (OT)" : "OT Hours",
      isLao ? "ເງິນເດືອນພື້ນຖານ (LAK)" : "Base Salary (LAK)",
      isLao ? "ຄ່າລ່ວງເວລາຊົ່ວໂມງ (Hourly OT LAK)" : "Hourly OT Pay (LAK)",
      isLao ? "ຄ່າລ່ວງເວລາມື້ (Daily OT LAK)" : "Daily OT Pay (LAK)",
      isLao ? "ໂບນັດ (+ LAK)" : "Bonus (+ LAK)",
      isLao ? "ຫັກເງິນ (- LAK)" : "Deductions (- LAK)",
      isLao ? "ເງິນສຸດທິ (LAK)" : "Net Pay (LAK)"
    ];
    
    const rows = monthlyPayroll.map(p => {
      return [
        `"${p.id}"`,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.position.replace(/"/g, '""')}"`,
        p.daysWorked,
        p.otDays,
        p.regularHours,
        p.overtimeHours,
        Math.round(p.baseSalaryEarned),
        Math.round(p.otPay),
        Math.round(p.otDaysPay),
        Math.round(p.bonus),
        Math.round(p.deduction),
        Math.round(p.totalPayout)
      ];
    });
    
    const csvContent = [
      headers.join(","),
      ...rows.map(r => r.join(","))
    ].join("\n");
    
    // Exact binary UTF-8 BOM (0xEF, 0xBB, 0xBF) to force Microsoft Excel to interpret Lao characters correctly
    const bomBytes = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bomBytes, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Payroll_Report_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintPayroll = () => {
    const style = document.createElement('style');
    style.id = 'payroll-print-style';
    style.innerHTML = `
      @page {
        size: A4 landscape !important;
        margin: 10mm !important;
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add('printing-payroll-ledger');
    window.print();
    document.body.classList.remove('printing-payroll-ledger');
    const oldStyle = document.getElementById('payroll-print-style');
    if (oldStyle) oldStyle.remove();
  };

  // Read Employee Rates & Rosters from Google Sheet if configured
  const fetchFromGoogleSheet = async () => {
    const sheetId = userSettings?.googleSheetsId;
    if (!sheetId) {
      setSyncStatus('warn');
      setSyncError(isLao ? 'ບໍ່ພົບ Spreadsheet ID, ກະລຸນາກຳນົດໃນເມນູ Settings ກ່ອນ.' : 'Spreadsheet ID not found. Fix it in Settings first.');
      return;
    }

    setSyncStatus('loading');
    setSyncError('');

    try {
      const [empRes, attRes, effRes] = await Promise.all([
        axios.get(`/api/sheets/hr-employees/${sheetId}`).catch(e => null),
        axios.get(`/api/sheets/hr-attendance/${sheetId}`).catch(e => null),
        axios.get(`/api/sheets/hr-efforts/${sheetId}`).catch(e => null)
      ]);

      let pulledEmployees: Employee[] = [];
      let pulledAttendance: Attendance[] = [];
      let pulledEfforts: Effort[] = [];

      // Process raw employee data if found with flexible Lao and English index detection
      if (empRes && empRes.data && empRes.data.values) {
        const rows = empRes.data.values as any[][];
        if (rows.length > 1) {
          const headers = rows[0].map(h => String(h).trim().toLowerCase());
          
          const idIdx = headers.findIndex(h => h.includes('id') || h.includes('ລະຫັດ'));
          const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('ຊື່') || h.includes('ພະນັກງານ'));
          const posIdx = headers.findIndex(h => h.includes('pos') || h.includes('role') || h.includes('ຕຳແໜ່ງ'));
          const rateIdx = headers.findIndex(h => h.includes('rate') || h.includes('hour') || h.includes('ຄ່າຈ້າງ') || h.includes('ຊົ່ວໂມງ') || h.includes('ຊມ'));
          const salaryIdx = headers.findIndex(h => h.includes('sal') || h.includes('base') || h.includes('ເງິນເດືອນ') || h.includes('ພື້ນຖານ'));
          const statusIdx = headers.findIndex(h => h.includes('stat') || h.includes('ສະຖານະ'));
          const phoneIdx = headers.findIndex(h => h.includes('phon') || h.includes('tel') || h.includes('ເບີໂທ') || h.includes('ຕິດຕໍ່'));

          pulledEmployees = rows.slice(1).map((row, idx) => {
            const getVal = (idxFound: number, fallback: any) => idxFound !== -1 && row[idxFound] !== undefined ? row[idxFound] : fallback;
            return {
              id: String(getVal(idIdx, `EMP00${idx + 1}`)).trim(),
              name: String(getVal(nameIdx, 'Unknown Employee')).trim(),
              position: String(getVal(posIdx, 'Staff')).trim(),
              hourlyRate: Number(getVal(rateIdx, 20000)) || 20000,
              baseSalary: Number(getVal(salaryIdx, 3500000)) || 3500000,
              status: String(getVal(statusIdx, 'Active')).trim(),
              phone: String(getVal(phoneIdx, '')).trim()
            };
          }).filter(emp => emp.name && emp.id);
        }
      }

      // Process raw attendance data if found with flexible Lao and English index detection
      if (attRes && attRes.data && attRes.data.values) {
        const rows = attRes.data.values as any[][];
        if (rows.length > 1) {
          const headers = rows[0].map(h => String(h).trim().toLowerCase());
          const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('ວັນທີ') || h.includes('ວັນ'));
          const empIdIdx = headers.findIndex(h => h.includes('emp') || h.includes('id') || h.includes('ລະຫັດ') || h === 'id' || h === 'ລະຫັດພະນັກງານ');
          const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('ຊື່') || h.includes('ພະນັກງານ') || h.includes('ຊື່ພະນັກງານ'));
          
          // Match Clock In exactly vs OT(mins) or Out
          const inIdx = headers.findIndex(h => h === 'clock in' || h === 'in' || h === 'ເຂົ້າວຽກ' || h === 'ເຂົ້າ' || (h.includes('in') && !h.includes('out') && !h.includes('ot') && !h.includes('print')));
          // Match Clock Out exactly vs In
          const outIdx = headers.findIndex(h => h === 'clock out' || h === 'out' || h === 'ອອກວຽກ' || h === 'ອອກ' || (h.includes('out') && !h.includes('in')));
          
          const hoursIdx = headers.findIndex(h => h.includes('ຊົ່ວໂມງ') || h.includes('hour') || h.includes('duration'));
          const otMinsIdx = headers.findIndex(h => h.includes('ot') || h.includes('overtime') || h.includes('ໂໂທີ') || h.includes('ລ່ວງເວລາ'));
          const breakIdx = headers.findIndex(h => h.includes('break') || h.includes('ພັກ'));
          const noteIdx = headers.findIndex(h => h.includes('note') || h.includes('remark') || h.includes('ໝາຍເຫດ'));

          pulledAttendance = rows.slice(1).map((row, idx) => {
            const getVal = (idxFound: number, fallback: any) => idxFound !== -1 && row[idxFound] !== undefined ? row[idxFound] : fallback;
            
            const rawIn = String(getVal(inIdx, '08:00')).trim();
            const rawOut = String(getVal(outIdx, '17:00')).trim();
            const rawHours = String(getVal(hoursIdx, '')).trim();
            const rawOT = String(getVal(otMinsIdx, '')).trim();
            const rawBreak = String(getVal(breakIdx, '')).trim();

            const formatTimeToHHMM = (timeStr: string): string => {
              if (!timeStr) return '';
              const parts = timeStr.trim().split(':');
              if (parts.length >= 2) {
                const hh = parts[0].padStart(2, '0');
                const mm = parts[1].padStart(2, '0');
                return `${hh}:${mm}`;
              }
              return timeStr;
            };

            const checkInFormatted = formatTimeToHHMM(rawIn);
            const checkOutFormatted = formatTimeToHHMM(rawOut);
            
            // Parse decimal hours
            const parsedHours = parseSheetHoursToDecimal(rawHours);
            
            // Parse OT minutes (e.g. "389" -> number)
            let parsedOTMins: number | null = null;
            if (rawOT && rawOT.toLowerCase() !== 'in') {
              const otNum = Number(rawOT);
              if (!isNaN(otNum)) {
                parsedOTMins = otNum;
              }
            }

            // Parse break minutes
            const parsedBreakMins = Number(rawBreak) || null;

            return {
              id: `ATT_S${idx}`,
              date: parseDateToYYYYMMDD(String(getVal(dateIdx, '')).trim()),
              employeeId: String(getVal(empIdIdx, '')).trim(),
              employeeName: String(getVal(nameIdx, '')).trim(),
              checkIn: checkInFormatted || '08:00',
              checkOut: checkOutFormatted || '17:00',
              notes: String(getVal(noteIdx, '')).trim(),
              totalHoursSheet: parsedHours,
              otMinsSheet: parsedOTMins,
              breakMinsSheet: parsedBreakMins
            };
          }).filter(att => att.date && att.employeeId);
        }
      }

      // Process raw efforts / productivity data if found
      if (effRes && effRes.data && effRes.data.values) {
        const rows = effRes.data.values as any[][];
        if (rows.length > 1) {
          const headers = rows[0].map(h => String(h).trim().toLowerCase());
          const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('month') || h.includes('ວັນທີ') || h.includes('ເດືອນ'));
          const empIdIdx = headers.findIndex(h => h.includes('id') || h.includes('ລະຫັດ'));
          const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('ຊື່') || h.includes('ພະນັກງານ'));
          const scoreIdx = headers.findIndex(h => h.includes('eff') || h.includes('score') || h.includes('rat') || h.includes('ຄະແນນ') || h.includes('ຄວາມພະຍາຍາມ'));
          const tasksIdx = headers.findIndex(h => h.includes('task') || h.includes('work') || h.includes('ວຽກ') || h.includes('ສຳເລັດ'));
          const noteIdx = headers.findIndex(h => h.includes('note') || h.includes('remark') || h.includes('ໝາຍເຫດ'));

          pulledEfforts = rows.slice(1).map((row, idx) => {
            const getVal = (idxFound: number, fallback: any) => idxFound !== -1 && row[idxFound] !== undefined ? row[idxFound] : fallback;
            return {
              id: `EFF_S${idx}`,
              date: parseDateToYYYYMMDD(String(getVal(dateIdx, '')).trim()),
              employeeId: String(getVal(empIdIdx, '')).trim(),
              employeeName: String(getVal(nameIdx, '')).trim(),
              score: Number(getVal(scoreIdx, 5)) || 5,
              tasksCount: Number(getVal(tasksIdx, 0)) || 0,
              notes: String(getVal(noteIdx, '')).trim()
            };
          }).filter(eff => eff.employeeId);
        }
      }

      if (pulledEmployees.length > 0) {
        // Apply overrides to pulled employees too!
        const savedOverrides = localStorage.getItem('hr_employee_overrides');
        const overrides = savedOverrides ? JSON.parse(savedOverrides) : {};
        const mergedEmployees = mergeOverrides(pulledEmployees, overrides);
        
        // Preserve any manually added local employees that aren't in the spreadsheet (match by ID and Name fallback)
        setEmployees(prevEmployees => {
          const localOnlyEmployees = prevEmployees.filter(localEmp => {
            const isFromSheet = mergedEmployees.some(sheetEmp => 
              sheetEmp.id === localEmp.id || 
              sheetEmp.name.trim().toLowerCase() === localEmp.name.trim().toLowerCase()
            );
            return !isFromSheet;
          });
          return [...mergedEmployees, ...localOnlyEmployees];
        });
      }
      if (pulledAttendance.length > 0) {
        setAttendance(pulledAttendance);
      }
      if (pulledEfforts.length > 0) {
        setEfforts(pulledEfforts);
      }

      setSyncStatus('success');
    } catch (err: any) {
      console.error("Sheets HR Pull error:", err);
      setSyncStatus('warn');
      setSyncError(
        isLao 
          ? 'ບໍ່ສາມາດດຶງຂໍ້ມູນຈາກ Google Sheet, ລະບົບໄດ້ໃຊ້ຂໍ້ມູນຈຳລອງ (Mock Data) ແທນ ເພື່ອໃຫ້ທ່ານສາມາດທົດລອງ ນຳໃຊ້ງານໄດ້.' 
          : 'Could not access Sheets. Falling back to active interactive simulation sandbox.'
      );
    }
  };

  // Perform sheet sync initially or when settings update
  useEffect(() => {
    if (userSettings?.googleSheetsId) {
      fetchFromGoogleSheet();
    }
  }, [userSettings?.googleSheetsId]);

  // Helper: calculate total decimal hours between hh:mm check-in & check-out
  const getWorkedHours = (checkIn: string, checkOut: string): number => {
    if (!checkIn || !checkOut) return 0;
    const [inH, inM] = checkIn.split(':').map(Number);
    const [outH, outM] = checkOut.split(':').map(Number);
    const inTotalMin = inH * 60 + inM;
    const outTotalMin = outH * 60 + outM;
    let totalMin = outTotalMin - inTotalMin;
    if (totalMin < 0) {
      // Overnight shifts (e.g. In 22:00, Out 03:00 of next day)
      totalMin += 24 * 60;
    }
    if (totalMin <= 0) return 0;
    return Math.round((totalMin / 60) * 100) / 100;
  };

  // Core Math - 07:00 - 16:00 regular shift, OT up to 20:00. Early checkIn cut to 07:00, late checkOut cut to 20:00
  // Shift 2: 12:00 - 20:00 regular shift, no OT, early checkIn cut to 12:00, late checkOut cut to 20:00
  const getAttendanceCalculation = (att: Attendance, emp?: Employee) => {
    const rate = emp ? emp.hourlyRate : 25000;
    const shiftType = emp?.shiftType || 'shift1';
    
    let standardHours = 0;
    let overtimeHours = 0;
    let totalHours = 0;

    if (att.checkIn && att.checkOut) {
      const [inH, inM] = att.checkIn.split(':').map(Number);
      const [outH, outM] = att.checkOut.split(':').map(Number);
      
      let inTotalMin = inH * 60 + inM;
      let outTotalMin = outH * 60 + outM;
      if (outTotalMin < inTotalMin) {
        outTotalMin += 24 * 60; // Overnight shifts
      }

      if (shiftType === 'shift2') {
        // Shift 2: 11:30 to 20:00 (690 to 1200 mins), OT past 20:00 (hourly).
        // If they check in before 11:30, it's cut to 11:30 (690 mins)
        const inTotalMinClamped = Math.max(690, inTotalMin);
        // Clamp check-out to end of day 24:00 (1440 mins)
        const outTotalMinClamped = Math.min(1440, outTotalMin);

        if (outTotalMinClamped > inTotalMinClamped) {
          // Standard hours are up to 20:00 (1200 mins)
          const standardMin = Math.max(0, Math.min(outTotalMinClamped, 1200) - inTotalMinClamped);
          standardHours = standardMin / 60;

          // Overtime hours are past 20:00 (1200 mins)
          const overtimeMin = Math.max(0, outTotalMinClamped - Math.max(inTotalMinClamped, 1200));
          overtimeHours = overtimeMin / 60;

          totalHours = standardHours + overtimeHours;
        }
      } else {
        // Shift 1: 07:00 to 16:00 (420 to 960 mins), OT up to 20:00 (1200 mins).
        // 1. If check-in is before 07:00 (420 mins), clamp it to 07:00 (420 mins)
        const inTotalMinClamped = Math.max(420, inTotalMin);
        
        // 2. If check-out is after 20:00 (1200 mins), clamp it to 20:00 (1200 mins)
        const outTotalMinClamped = Math.min(1200, outTotalMin);

        if (outTotalMinClamped > inTotalMinClamped) {
          // Standard hours are between inTotalMinClamped and 16:00 (960 mins)
          const standardMin = Math.max(0, Math.min(outTotalMinClamped, 960) - inTotalMinClamped);
          standardHours = standardMin / 60;

          // Overtime hours are between 16:00 (960 mins) and outTotalMinClamped (capped at 20:00 / 1200 mins)
          const overtimeMin = Math.max(0, outTotalMinClamped - Math.max(inTotalMinClamped, 960));
          overtimeHours = overtimeMin / 60;

          totalHours = standardHours + overtimeHours;
        }
      }
    } else {
      // Fallback/fallback sheets handling if checkIn/checkOut is not defined
      if (att.totalHoursSheet !== undefined && att.totalHoursSheet !== null) {
        totalHours = att.totalHoursSheet;
      }
      if (att.otMinsSheet !== undefined && att.otMinsSheet !== null) {
        overtimeHours = Math.max(0, att.otMinsSheet / 60);
      } else {
        overtimeHours = Math.max(0, totalHours - 9);
      }
      standardHours = Math.max(0, totalHours - overtimeHours);
    }
    
    // Choose OT Rate: check employee override first, then global
    const otType = emp?.otCalcType || globalOTRateType;
    const otVal = emp?.otRateValue !== undefined && emp?.otRateValue !== null ? emp.otRateValue : globalOTRateValue;

    let otHourlyRate = rate * 1.5; // default fallback
    if (otType === 'flat') {
      otHourlyRate = otVal;
    } else {
      otHourlyRate = rate * otVal; // multiplier
    }

    const standardPay = standardHours * rate;
    const overtimePay = overtimeHours * otHourlyRate;
    const totalPay = standardPay + overtimePay;

    return {
      totalHours: Math.round(totalHours * 100) / 100,
      standardHours: Math.round(standardHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      otHourlyRate,
      standardPay,
      overtimePay,
      totalPay
    };
  };

  // Payroll aggregator for selected month with detailed absences computations
  const monthlyPayroll = useMemo(() => {
    const records = attendance.filter(att => att.date.startsWith(selectedMonth));
    const dynamicDefaultDays = getExpectedWorkDaysForMonth(selectedMonth);

    const getWeekNumber = (dateStr: string): string => {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      // ISO week calculation
      const day = date.getDay() || 7;
      date.setDate(date.getDate() + 4 - day);
      const yearStart = new Date(date.getFullYear(), 0, 1);
      const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${date.getFullYear()}-W${weekNo}`;
    };

    return employees.map(emp => {
      // All attendance entries for this employee inside the month
      const empAtt = records.filter(att => att.employeeId === emp.id);
      
      let totalWorks = 0;
      let totalRegularHours = 0;
      let totalOvertimeHours = 0;
      let totalOTPay = 0;
      let totalStandardPay = 0;
      let calculatedEarnings = 0;

      // Group days by ISO week
      const daysByWeek: { [week: string]: number } = {};

      empAtt.forEach(att => {
        const cal = getAttendanceCalculation(att, emp);
        totalWorks++;
        totalRegularHours += cal.standardHours;
        totalOvertimeHours += cal.overtimeHours;
        totalOTPay += cal.overtimePay;
        totalStandardPay += cal.standardPay;
        calculatedEarnings += cal.totalPay;

        const wKey = getWeekNumber(att.date);
        if (wKey) {
          daysByWeek[wKey] = (daysByWeek[wKey] || 0) + 1;
        }
      });

      // Filter all efforts and productivity scores for this employee
      const empEffs = efforts.filter(eff => eff.employeeId === emp.id && (!eff.date || eff.date.startsWith(selectedMonth)));
      const avgEffort = empEffs.length > 0 ? (empEffs.reduce((sum, eff) => sum + eff.score, 0) / empEffs.length).toFixed(1) : null;
      const totalTasks = empEffs.reduce((sum, eff) => sum + (eff.tasksCount || 0), 0);

      // Fetch manual adjustments (bonus/deductions)
      const adjKey = `${emp.id}_${selectedMonth}`;
      const adj = adjustments[adjKey] || { bonus: 0, deduction: 0, notes: '' };

      // Calculate leaves & absences for this employee
      const empLeaves = leaveLogs.filter(lv => lv.employeeId === emp.id && lv.date.startsWith(selectedMonth));
      const expectedDays = emp.expectedWorkDays !== undefined && emp.expectedWorkDays !== 26
        ? emp.expectedWorkDays
        : dynamicDefaultDays;
      const sickDays = empLeaves.filter(lv => lv.type === 'sick').length;
      const personalDays = empLeaves.filter(lv => lv.type === 'personal').length;
      const annualDays = empLeaves.filter(lv => lv.type === 'annual').length;
      const unexcusedDays = empLeaves.filter(lv => lv.type === 'unexcused').length;
      
      // Untracked missing days
      const untrackedMissingDays = Math.max(0, expectedDays - totalWorks - empLeaves.length);
      const totalAbsents = untrackedMissingDays + unexcusedDays;

      // Calculate OT Days:
      // Works more than 6 days/week or 26 days/month (or custom expectedWorkDays)
      let weeklyExcessDays = 0;
      Object.keys(daysByWeek).forEach(week => {
        const daysInWeek = daysByWeek[week];
        if (daysInWeek > 6) {
          weeklyExcessDays += (daysInWeek - 6);
        }
      });

      const monthlyExcessDays = Math.max(0, totalWorks - expectedDays);

      // Total OT days is the max or union of these excess days to avoid double counting
      const otDays = Math.max(weeklyExcessDays, monthlyExcessDays);

      // Determine if salaried or hourly (if baseSalary > 0, assume salaried)
      const isSalaried = emp.baseSalary > 0;

      // Daily rate calculation:
      // Salaried: baseSalary / expectedWorkDays. Hourly: hourlyRate * 8.
      const dailyRate = isSalaried 
        ? (emp.baseSalary / expectedDays)
        : (emp.hourlyRate * 8);

      const otVal = emp?.otRateValue !== undefined && emp?.otRateValue !== null ? emp.otRateValue : globalOTRateValue;
      const otDayRate = dailyRate * otVal;
      const otDaysPay = Math.round(otDays * otDayRate);

      // Pro-rate base salary for unpaid absences can be computed as:
      const unpaidDays = untrackedMissingDays + unexcusedDays;
      const paidDays = Math.max(0, expectedDays - unpaidDays);
      const baseSalaryEarned = isSalaried 
        ? Math.round(emp.baseSalary * (paidDays / expectedDays))
        : totalStandardPay;

      const finalAmount = baseSalaryEarned + totalOTPay + otDaysPay + adj.bonus - adj.deduction;

      return {
        ...emp,
        daysWorked: totalWorks,
        regularHours: Math.round(totalRegularHours * 100) / 100,
        overtimeHours: Math.round(totalOvertimeHours * 100) / 100,
        otPay: totalOTPay,
        otDays,
        otDaysPay,
        standardPay: totalStandardPay,
        baseSalaryEarned,
        calculatedEarnings,
        bonus: adj.bonus,
        deduction: adj.deduction,
        adjustmentNotes: adj.notes || '',
        totalPayout: finalAmount,
        avgEffort,
        totalTasks,
        expectedDays,
        sickDays,
        personalDays,
        annualDays,
        unexcusedDays,
        untrackedMissingDays,
        totalAbsents
      };
    });
  }, [employees, attendance, efforts, leaveLogs, selectedMonth, adjustments, globalOTRateType, globalOTRateValue]);

  // Overall Payroll Summary Metrics
  const summaryMetrics = useMemo(() => {
    let totRegularHours = 0;
    let totOvertimeHours = 0;
    let totPayroll = 0;
    let otPay = 0;
    let totalBonus = 0;
    let totalDeduction = 0;

    monthlyPayroll.forEach(p => {
      totRegularHours += p.regularHours;
      totOvertimeHours += p.overtimeHours;
      totPayroll += p.totalPayout;
      totalBonus += p.bonus;
      totalDeduction += p.deduction;
      otPay += (p.otPay || 0) + (p.otDaysPay || 0);
    });

    return {
      totalHours: Math.round((totRegularHours + totOvertimeHours) * 10) / 10,
      regularHours: Math.round(totRegularHours * 10) / 10,
      overtimeHours: Math.round(totOvertimeHours * 10) / 10,
      totalEarnings: totPayroll,
      overtimeValue: otPay,
      totalBonus,
      totalDeduction
    };
  }, [monthlyPayroll]);

  // Filter attendance log for rendering
  const filteredAttendance = useMemo(() => {
    return attendance.filter(att => {
      const matchEmp = filterEmployeeId === 'all' || att.employeeId === filterEmployeeId;
      const matchDate = att.date.startsWith(selectedMonth);
      const matchSearch = searchTerm === '' || 
        att.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        att.employeeId.toLowerCase().includes(searchTerm.toLowerCase());
      return matchEmp && matchDate && matchSearch;
    });
  }, [attendance, filterEmployeeId, selectedMonth, searchTerm]);

  // Handle addition of temporary employees in client-side state
  const handleCreateEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmployee.id || !newEmployee.name) return;
    const emp: Employee = {
      id: newEmployee.id,
      name: newEmployee.name,
      position: newEmployee.position || 'Staff',
      hourlyRate: Number(newEmployee.hourlyRate) || 20000,
      baseSalary: Number(newEmployee.baseSalary) || 3500000,
      status: newEmployee.status || 'Active',
      phone: newEmployee.phone || '',
      otCalcType: newEmployee.otCalcType || 'multiplier',
      otRateValue: newEmployee.otRateValue !== undefined ? Number(newEmployee.otRateValue) : 1.5,
      expectedWorkDays: newEmployee.expectedWorkDays !== undefined ? Number(newEmployee.expectedWorkDays) : 26,
      shiftType: newEmployee.shiftType || 'shift1'
    };
    setEmployees(prev => [emp, ...prev]);
    setIsAddingEmployee(false);
    setNewEmployee({ id: '', name: '', position: '', hourlyRate: 20000, baseSalary: 3500000, status: 'Active', otCalcType: 'multiplier', otRateValue: 1.5, expectedWorkDays: 26, shiftType: 'shift1' });
  };

  // Handle addition of custom attendance logs
  const handleLogAttendance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLog.employeeId || !newLog.date) return;
    
    const emp = employees.find(e => e.id === newLog.employeeId);
    if (!emp) return;

    const log: Attendance = {
      id: `ATT_${Date.now()}`,
      date: newLog.date,
      employeeId: newLog.employeeId,
      employeeName: emp.name,
      checkIn: newLog.checkIn || '07:00',
      checkOut: newLog.checkOut || '16:00',
      notes: newLog.notes || ''
    };

    setAttendance(prev => [log, ...prev]);
    setIsLoggingAttendance(false);
    setNewLog({
      date: new Date().toISOString().split('T')[0],
      employeeId: '',
      checkIn: '07:00',
      checkOut: '16:00',
      notes: ''
    });
  };

  // Handle adding custom leaves/absences
  const handleAddLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeave.employeeId || !newLeave.date) return;

    const emp = employees.find(e => e.id === newLeave.employeeId);
    if (!emp) return;

    const log: LeaveLog = {
      id: `LV_${Date.now()}`,
      employeeId: newLeave.employeeId,
      employeeName: emp.name,
      date: newLeave.date,
      type: (newLeave.type || 'sick') as any,
      reason: newLeave.reason || ''
    };

    setLeaveLogs(prev => [log, ...prev]);
    setIsAddingLeave(false);
    setNewLeave({
      employeeId: '',
      date: new Date().toISOString().split('T')[0],
      type: 'sick',
      reason: ''
    });
  };

  // Adjust bonus or deduction inline
  const updateAdjustment = (empId: string, type: 'bonus' | 'deduction', val: number) => {
    const key = `${empId}_${selectedMonth}`;
    const cur = adjustments[key] || { employeeId: empId, month: selectedMonth, bonus: 0, deduction: 0, notes: '' };
    
    setAdjustments(prev => ({
      ...prev,
      [key]: {
        ...cur,
        [type]: val
      }
    }));
  };

  const updateAdjustmentNote = (empId: string, note: string) => {
    const key = `${empId}_${selectedMonth}`;
    const cur = adjustments[key] || { employeeId: empId, month: selectedMonth, bonus: 0, deduction: 0, notes: '' };
    
    setAdjustments(prev => ({
      ...prev,
      [key]: {
        ...cur,
        notes: note
      }
    }));
  };

  return (
    <div className="space-y-6">
      
      {/* Page Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[#052659] dark:text-white flex items-center gap-3">
            <Users className="w-8 h-8 text-blue-500" />
            {isLao ? 'ລະບົບບໍລິຫານບຸກຄະລາກອນ & ເງິນເດືອນ' : 'La Dolce HR & Payroll Studio'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mt-1">
            {isLao ? 'ຕິດຕາມໂມງເຮັດວຽກ, ຄຳນວນ OT ເກີນ 9 ຊົ່ວໂມງ ແລະ ຖານເງິນເດືອນ' : 'Track attendance, OT above 9 hrs/day & compute standard payroll'}
          </p>
        </div>

        {/* Month Selector & Custom Sync Status */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <CalendarIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 pl-9 pr-3 text-xs font-black uppercase tracking-wider bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-white"
            />
          </div>

          <button
            onClick={fetchFromGoogleSheet}
            className="h-9 px-4 text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-xl flex items-center gap-2 transition-all shadow-md active:scale-95"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {isLao ? 'ດຶງຂໍ້ມູນຈາກ Google Sheet' : 'Sync Google Sheet'}
          </button>
        </div>
      </div>

      {/* Sync State Alert Box & Setup Guides */}
      {syncStatus !== 'idle' && (
        <div className={`p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 ${
          syncStatus === 'loading' 
            ? 'bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400' 
            : syncStatus === 'success'
            ? 'bg-green-500/5 border-green-500/20 text-green-700 dark:text-green-400'
            : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400'
        }`}>
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black uppercase tracking-widest leading-none mb-1">
                {syncStatus === 'loading' && (isLao ? 'ກຳລັງອ່ານຂໍ້ມູນ...' : 'Reading Sheet Data...')}
                {syncStatus === 'success' && (isLao ? 'ດຶງຂໍ້ມູນສຳເລັດແລ້ວ!' : 'Sheet Connection Active!')}
                {syncStatus === 'warn' && (isLao ? 'ສະຖານະການເຊື່ອມຕໍ່ຂໍ້ມູນ' : 'Integrated Simulator Sandbox')}
              </p>
              <p className="text-xs opacity-80 font-bold leading-normal">
                {syncError || (
                  syncStatus === 'success' 
                    ? (isLao ? `ດຶງຂໍ້ມູນພະນັກງານ ${employees.length} ຄົນ, ການເຂົ້າ-ອອກວຽກ ${attendance.length} ລາຍການ, ແລະ ຂໍ້ມູນຄວາມພະຍາຍາມ ${efforts.length} ລາຍການ ຈາກ Spreadsheet ສຳເລັດ.` : `Pulled ${employees.length} employees, ${attendance.length} attendance rows & ${efforts.length} efforts from Google Sheets successfully.`)
                    : (isLao 
                        ? 'ລະບົບກຳລັງນຳໃຊ້ຂໍ້ມູນຈຳລອງ Interactive Simulator. ເພື່ອດຶງຂໍ້ມູນແທ້, ທ່ານສາມາດຕັ້ງຊື່ Tab ເປັນພາສາລາວ "ຂໍ້ມູນພະນັກງານ", "ການເຂົ້າວຽກ", "ຄວາມພະຍາຍາມ" ຫຼື ພາສາອັງກິດ "HR_EMPLOYEES", "HR_ATTENDANCE", "HR_EFFORTS" ໃນ Google Sheet.' 
                        : 'System is running on interactive simulation. To read live data, name your sheets "HR_EMPLOYEES" (or "ຂໍ້ມູນພະນັກງານ"), "HR_ATTENDANCE" (or "ການເຂົ້າວຽກ"), and optionally "HR_EFFORTS" (or "ຄວາມພະຍາຍາມ").')
                )}
              </p>
            </div>
          </div>
          
          <div className="flex items-center flex-wrap gap-2">
            <button 
              onClick={() => {
                navigator.clipboard.writeText('ພະນັກງານ');
                alert(isLao ? 'ກັອບປີ້ "ພະນັກງານ" ແລ້ວ!' : 'Copied "ພະນັກງານ" name!');
              }}
              className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-1.5 rounded-lg flex items-center gap-1.5 focus:outline-none text-slate-600 dark:text-slate-300"
            >
              <Copy className="w-3 h-3" />
              {isLao ? 'ກັອບຊື່ Tab ພະນັກງານ' : 'Copy Staff Tab'}
            </button>
            <button 
              onClick={() => {
                navigator.clipboard.writeText('ການເຂົ້າວຽກ');
                alert(isLao ? 'ກັອບປີ້ "ການເຂົ້າວຽກ" ແລ້ວ!' : 'Copied "ການເຂົ້າວຽກ" name!');
              }}
              className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-1.5 rounded-lg flex items-center gap-1.5 focus:outline-none text-slate-600 dark:text-slate-300"
            >
              <Copy className="w-3 h-3" />
              {isLao ? 'ກັອບຊື່ Tab ການເຂົ້າວຽກ' : 'Copy ATT Tab'}
            </button>
            <button 
              onClick={() => {
                navigator.clipboard.writeText('ຄວາມພະຍາຍາມ');
                alert(isLao ? 'ກັອບປີ້ "ຄວາມພະຍາຍາມ" ແລ້ວ!' : 'Copied "ຄວາມພະຍາຍາມ" name!');
              }}
              className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 px-3 py-1.5 rounded-lg flex items-center gap-1.5 focus:outline-none text-slate-600 dark:text-slate-300"
            >
              <Copy className="w-3 h-3" />
              {isLao ? 'ກັອບຊື່ Tab ຄວາມພະຍາຍາມ' : 'Copy Effort Tab'}
            </button>
          </div>
        </div>
      )}

      {/* Top Level Summary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        {/* KPI: Total Employees */}
        <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              {isLao ? 'ພະນັກງານທັງໝົດ' : 'Total Employees'}
            </h4>
            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-[#052659] dark:text-white leading-none">
            {employees.length} <span className="text-sm font-bold text-slate-400">{isLao ? 'ຄົນ' : 'Persons'}</span>
          </p>
          <div className="mt-2 text-[10px] text-green-500 font-bold flex items-center gap-1">
            <Check className="w-3 h-3" />
            {isLao ? 'ທຸກຄົນຢູ່ໃນສະຖານະການເຄື່ອນໄຫວ' : 'All active staffing roster'}
          </div>
        </div>

        {/* KPI: Total Worked Hours */}
        <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              {isLao ? 'ຊົ່ວໂມງເຮັດວຽກສະສົມ' : 'Worked Hours'}
            </h4>
            <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-[#052659] dark:text-white leading-none">
            {summaryMetrics.totalHours.toLocaleString()} <span className="text-sm font-bold text-slate-400">{isLao ? 'ຊມ' : 'Hrs'}</span>
          </p>
          <div className="mt-2 text-[10px] text-slate-400 font-bold">
            {isLao ? `ປົກກະຕິ: ${summaryMetrics.regularHours} ຊມ` : `Regular Duty: ${summaryMetrics.regularHours} Hrs`}
          </div>
        </div>

        {/* KPI: Overtime Accumulator */}
        <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              {isLao ? 'ຊົ່ວໂມງລ່ວງເວລາ (OT)' : 'Overtime Hours'}
              <span className="text-[10px] bg-red-500/10 text-red-500 px-1 py-0.5 rounded shrink-0">{isLao ? '>9ຊມ' : '>9h'}</span>
            </h4>
            <div className="p-2 bg-red-500/10 text-red-500 rounded-xl">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-red-500 leading-none">
            {summaryMetrics.overtimeHours.toLocaleString()} <span className="text-sm font-bold text-red-400/80">{isLao ? 'ຊມ' : 'Hrs'}</span>
          </p>
          <div className="mt-2 text-[10px] text-red-500 font-bold">
            {isLao 
              ? `ມູນຄ່າ OT: +${Math.round(summaryMetrics.overtimeValue).toLocaleString()} LAK (1.5x)` 
              : `OT Valuation: +${Math.round(summaryMetrics.overtimeValue).toLocaleString()} LAK`}
          </div>
        </div>

        {/* KPI: Est Payroll */}
        <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">
              {isLao ? 'ລວມຄ່າຈ້າງທັງໝົດ' : 'Total Payroll Cost'}
            </h4>
            <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-blue-600 dark:text-blue-300 leading-none">
            {Math.round(summaryMetrics.totalEarnings).toLocaleString()} <span className="text-sm font-bold text-slate-400">₭</span>
          </p>
          <div className="mt-2 text-[10px] text-slate-400 font-bold">
            {isLao ? `ຄິດໄລ່ສຳລັບເດືອນ: ${selectedMonth}` : `Calculated for: ${selectedMonth}`}
          </div>
        </div>
      </div>

      {/* Dynamic Multiplier & Computation Control Header */}
      <div className="bg-gradient-to-r from-blue-500/10 via-emerald-500/5 to-slate-500/10 dark:from-blue-950/40 dark:via-emerald-950/20 dark:to-slate-900/40 border border-slate-100 dark:border-white/5 rounded-2xl p-5 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-5">
        <div className="space-y-1.5">
          <p className="text-xs font-black uppercase tracking-widest text-blue-500 flex items-center gap-1.5">
            <Settings className="w-4 h-4 animate-spin-slow text-blue-500" />
            {isLao ? 'ຕັ້ງຄ່າອັດຕາການຄິດໄລ່ OT ຂອງລະບົບ' : 'System-wide Overtime (OT) Engine Configure'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-300 font-bold max-w-xl">
            {isLao 
              ? 'ປັບປ່ຽນອັດຕາຄູນ OT (ເຊັ່ນ: 1.5, 2.0 ຂອງຖານຊົ່ວໂມງ) ຫຼື ກຳນົດເປັນຈຳນວນເງິນຄົງທີ່ຕໍ່ຊົ່ວໂມງ ລະບົບຈະຄິດໄລ່ລາຍງານທັງໝົດຄືນໃໝ່ໂດຍອັດຕະໂນມັດ.' 
              : 'Modify standard 1.5x/2.0x OT multipliers or enter flat hourly LAK rewards. The core engine updates all payroll items instantly.'}
          </p>
          
          <div className="flex items-center gap-3 pt-1.5">
            {/* OT Rate Type Selector */}
            <div className="flex bg-slate-100 dark:bg-[#052659] p-1 rounded-xl">
              <button
                onClick={() => setGlobalOTRateType('multiplier')}
                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all ${
                  globalOTRateType === 'multiplier' 
                    ? 'bg-blue-500 text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                {isLao ? 'ອັດຕາຄູນພື້ນຖານ (Multiplier)' : 'Multiplier Rate'}
              </button>
              <button
                onClick={() => setGlobalOTRateType('flat')}
                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all ${
                  globalOTRateType === 'flat' 
                    ? 'bg-blue-500 text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                }`}
              >
                {isLao ? 'ຈ່າຍຄົງທີ່ຕໍ່ຊົ່ວໂມງ (Flat LAK)' : 'Flat Hourly Rate'}
              </button>
            </div>

            {/* OT Rate Input */}
            <div className="flex items-center gap-1">
              <input
                type="number"
                step={globalOTRateType === 'multiplier' ? '0.1' : '5000'}
                value={globalOTRateValue || ''}
                onChange={e => setGlobalOTRateValue(Number(e.target.value))}
                className="w-24 text-right bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-xl p-1.5 text-xs font-black text-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={globalOTRateType === 'multiplier' ? '1.5' : '30000'}
              />
              <span className="text-[10px] font-bold text-slate-400">
                {globalOTRateType === 'multiplier' ? 'x' : '₭'}
              </span>
            </div>
          </div>
        </div>

        {/* Action button triggers Advanced Salary Breakdown Modal & Tab switchers */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 w-full xl:w-auto flex-wrap">
          {/* Section Tab Group Switcher */}
          <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200/50 dark:border-white/5 w-full sm:w-auto">
            <button
              onClick={() => setActiveSectionTab('payroll')}
              className={`text-xs font-black uppercase tracking-wider px-4 py-2.5 sm:py-2 rounded-lg transition-all flex-1 sm:flex-initial flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 ${
                activeSectionTab === 'payroll' 
                  ? 'bg-white dark:bg-[#073069] text-[#052659] dark:text-white shadow-sm font-black' 
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              {isLao ? 'ເງິນເດືອນ & ລົງເວລາ' : 'Payroll & Clocklogs'}
            </button>
            <button
              onClick={() => setActiveSectionTab('leaves')}
              className={`text-xs font-black uppercase tracking-wider px-4 py-2.5 sm:py-2 rounded-lg transition-all flex-1 sm:flex-initial flex items-center justify-center gap-2 min-h-[44px] sm:min-h-0 ${
                activeSectionTab === 'leaves' 
                  ? 'bg-white dark:bg-[#073069] text-[#052659] dark:text-white shadow-sm font-black' 
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
              }`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              {isLao ? 'ຕິດຕາມການຂາດວຽກ/ໃບລາ' : 'Absences & Leaves'}
            </button>
          </div>

          <button
            onClick={() => setIsPayrollModalOpen(true)}
            className="px-5 py-3 text-xs font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 w-full sm:w-auto min-h-[44px] sm:min-h-0 border-0"
          >
            <CircleDollarSign className="w-4.5 h-4.5" />
            {isLao ? 'ຄຳນວນເງິນເດືອນ Advanced' : 'Calculate Salary Report'}
          </button>
        </div>
      </div>

      {/* Main HR Layout Tab-Group Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1: Staff Directory & Control Panel */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm overflow-hidden p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#052659] dark:text-white">
                {isLao ? 'ລາຍຊື່ພະນັກງານ' : 'Staff Directory'}
              </h3>
              <button 
                onClick={() => setIsAddingEmployee(!isAddingEmployee)}
                className="p-1 px-2.5 text-[10px] font-black uppercase tracking-widest bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 rounded-lg flex items-center gap-1 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                {isLao ? 'ເພີ່ມພະນັກງານ' : 'Add Employee'}
              </button>
            </div>

            {/* Quick Add Employee Drawer */}
            {isAddingEmployee && (
              <form onSubmit={handleCreateEmployee} className="mb-6 p-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-200/50 pb-1">
                  {isLao ? 'ເພີ່ມພະນັກງານໃໝ່' : 'New Staff Onboarding'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">Code/ID</label>
                    <input 
                      type="text" 
                      placeholder="EMP005"
                      value={newEmployee.id || ''}
                      onChange={e => setNewEmployee(p => ({...p, id: e.target.value.toUpperCase()}))}
                      className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ຕຳແໜ່ງ' : 'Position'}</label>
                    <input 
                      type="text" 
                      placeholder="Barista"
                      value={newEmployee.position || ''}
                      onChange={e => setNewEmployee(p => ({...p, position: e.target.value}))}
                      className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ຊື່ເຕັມ' : 'Full Name'}</label>
                  <input 
                    type="text" 
                    placeholder="M. Phouthasa Singsom"
                    value={newEmployee.name || ''}
                    onChange={e => setNewEmployee(p => ({...p, name: e.target.value}))}
                    className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ຄ່າຈ້າງ/ຊົ່ວໂມງ' : 'Hourly Rate'}</label>
                    <input 
                      type="number" 
                      value={newEmployee.hourlyRate || 0}
                      onChange={e => setNewEmployee(p => ({...p, hourlyRate: Number(e.target.value)}))}
                      className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ເງິນເດືອນພື້ນຖານ' : 'Base Salary'}</label>
                    <input 
                      type="number" 
                      value={newEmployee.baseSalary || 0}
                      onChange={e => setNewEmployee(p => ({...p, baseSalary: Number(e.target.value)}))}
                      className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">
                    {isLao ? 'ກະການເຮັດວຽກ' : 'Shift Type'}
                  </label>
                  <select
                    value={newEmployee.shiftType || 'shift1'}
                    onChange={e => setNewEmployee(p => ({...p, shiftType: e.target.value as 'shift1' | 'shift2'}))}
                    className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none text-slate-700 dark:text-white"
                  >
                    <option value="shift1">{isLao ? 'ກະ 1: 07:00 - 16:00 (ມີ OT)' : 'Shift 1: 07:00 - 16:00 (with OT)'}</option>
                    <option value="shift2">{isLao ? 'ກະ 2: 11:30 - 20:00 (ມີ OT)' : 'Shift 2: 11:30 - 20:00 (with OT)'}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button type="submit" className="flex-1 py-1.5 text-[10px] font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">
                    {isLao ? 'ບັນທຶກ' : 'Register'}
                  </button>
                  <button type="button" onClick={() => setIsAddingEmployee(false)} className="flex-1 py-1.5 text-[10px] font-bold bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-lg transition-colors">
                    {isLao ? 'ຍົກເລີກ' : 'Cancel'}
                  </button>
                </div>
              </form>
            )}

            {/* List Employees */}
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {employees.map(emp => {
                // Find efforts for this employee
                const empAtt = efforts.filter(eff => eff.employeeId === emp.id && (!eff.date || eff.date.startsWith(selectedMonth)));
                const avgEffort = empAtt.length > 0 ? (empAtt.reduce((sum, eff) => sum + eff.score, 0) / empAtt.length).toFixed(1) : null;

                return (
                  <div 
                    key={emp.id} 
                    onClick={() => setSelectedEmployeeForProfile(emp)}
                    className="p-3 bg-slate-50 hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-100 dark:border-white/5 hover:border-blue-500/30 dark:hover:border-blue-500/20 rounded-xl flex items-center justify-between gap-3 text-slate-700 dark:text-white cursor-pointer transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[8px] font-black uppercase bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded shrink-0">{emp.id}</span>
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${emp.shiftType === 'shift2' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-300' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'}`}>
                          {emp.shiftType === 'shift2' ? (isLao ? 'ກະ 2 (11:30-20)' : 'Shift 2 (11:30-20)') : (isLao ? 'ກະ 1 (07-16)' : 'Shift 1 (07-16)')}
                        </span>
                        <p className="text-xs font-bold leading-tight truncate">{emp.name}</p>
                      </div>
                      <div className="flex items-center flex-wrap gap-2 mt-1 text-[10px] opacity-60">
                        <span>{emp.position}</span>
                        <span>•</span>
                        <span>{emp.hourlyRate?.toLocaleString()} ₭/{isLao ? 'ຊມ' : 'hr'}</span>
                        <span>•</span>
                        <span className="font-bold text-blue-600 dark:text-blue-300">
                          {isLao ? 'ເງິນເດືອນພື້ນຖານ:' : 'Salary:'} {emp.baseSalary?.toLocaleString()} ₭
                        </span>
                        {avgEffort && (
                          <>
                            <span>•</span>
                            <span className="bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold px-1 rounded flex items-center gap-0.5">⚡ {avgEffort}/10</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEmployeeForProfile(emp);
                        }}
                        className="px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-1 transition-all shadow-sm active:scale-95 border-0"
                      >
                        <Coins className="w-3 h-3 text-white" />
                        {isLao ? 'ປັບເງິນເດືອນ' : 'Adjust Salary'}
                      </button>

                      <button 
                        onClick={(e) => {
                          e.stopPropagation(); // Stop modal from triggering
                          if (confirm(isLao ? 'ຕ້ອງການລົບລາຍຊື່ພະນັກງານຄົນນີ້?' : 'Delete this employee?')) {
                            setEmployees(prev => prev.filter(e => e.id !== emp.id));
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:bg-red-500/10 rounded-lg transition-colors shrink-0 border-0 bg-transparent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Attendance Logging Card */}
          <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-[#052659] dark:text-white">
                {isLao ? 'ລົງເວລາເຂົ້າ-ອອກ' : 'Log Attendance'}
              </h3>
              <button 
                onClick={() => setIsLoggingAttendance(!isLoggingAttendance)}
                className="p-1 px-2.5 text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg flex items-center gap-1 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                {isLao ? 'ປ້ອນເຂົ້າວຽກ' : 'Log Time'}
              </button>
            </div>

            {isLoggingAttendance && (
              <form onSubmit={handleLogAttendance} className="p-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#052659] dark:text-white border-b border-slate-200/50 pb-1">
                  {isLao ? 'ບັນທຶກຊົ່ວໂມງເຮັດວຽກ' : 'Roster Log Hours'}
                </p>
                
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ເລືອກພະນັກງານ' : 'Select Employee'}</label>
                  <select
                    value={newLog.employeeId || ''}
                    onChange={e => setNewLog(p => ({...p, employeeId: e.target.value}))}
                    className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                    required
                  >
                    <option value="">{isLao ? '-- ເລືອກ --' : '-- Select Employee --'}</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.name} ({e.id})</option>
                    ))}
                  </select>
                </div>

                <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-[10px] font-bold text-blue-600 dark:text-blue-300 leading-normal flex items-start gap-2">
                  <Clock className="w-4 h-4 shrink-0 mt-0.5 text-blue-500 animate-pulse" />
                  <div>
                    <p className="font-extrabold uppercase">
                      {isLao ? 'ອ່ານເວລາເຂົ້າ-ອອກ ອັດຕະໂນມັດ' : 'Auto Check-In/Out Tracking'}
                    </p>
                    <p className="opacity-90 font-semibold mt-0.5">
                      {isLao 
                        ? 'ໂມງເຂົ້າ-ອອກ ຈະຖືກສະແດງໂດຍອັດຕະໂນມັດຈາກ Sheet "ການເຂົ້າວຽກ" ເພື່ອຕິດຕາມການຈ້ຳໂມງ. ບໍ່ຈຳເປັນຕ້ອງປ້ອນເອງ.'
                        : 'Check-In/Out times are synchronized automatically from your Google Sheet "ການເຂົ້າວຽກ" tab.'}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ວັນທີ' : 'Date'}</label>
                  <input 
                    type="date" 
                    value={newLog.date || ''}
                    onChange={e => setNewLog(p => ({...p, date: e.target.value}))}
                    className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ໝາຍເຫດ' : 'Notes/Remarks'}</label>
                  <input 
                    type="text" 
                    placeholder="Weekend peak / prep"
                    value={newLog.notes || ''}
                    onChange={e => setNewLog(p => ({...p, notes: e.target.value}))}
                    className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button type="submit" className="flex-1 py-1.5 text-[10px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors">
                    {isLao ? 'ບັນທຶກເຂົ້າວຽກ' : 'Register Logs'}
                  </button>
                  <button type="button" onClick={() => setIsLoggingAttendance(false)} className="flex-1 py-1.5 text-[10px] font-bold bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-lg transition-colors">
                    {isLao ? 'ຍົກເລີກ' : 'Cancel'}
                  </button>
                </div>
              </form>
            )}

            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold leading-normal">
              {isLao 
                ? 'ໂມງມາດຕະຖານແມ່ນ 9 ຊົ່ວໂມງ/ວັນ. ໂມງເຮັດວຽກທີ່ເກີນ 9 ຊົ່ວໂມງ ຈະຖືກນັບເປັນ OT (ຄ່າຈ້າງລ່ວງເວລາຄູນ 1.5).' 
                : 'Default standard work hours are 9 hours per day. Hours exceeding 9 are valued as OT with 1.5x multiplier.'}
            </p>
          </div>
        </div>

        {/* Column 2 & 3: Attendance Reports, Payroll Worksheet & Absence management */}
        <div className="lg:col-span-2 space-y-6">

          {activeSectionTab === 'payroll' && (
            <>
              {/* Payroll Worksheet & Salary calculations Grid */}
              <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm p-6 overflow-hidden">
                <h3 className="text-sm font-black uppercase tracking-widest text-[#052659] dark:text-white mb-4">
                  {isLao ? `ຕາຕະລາງສ່ວນການຄິດໄລ່ເງິນເດືອນ: ${selectedMonth}` : `Payroll base computations Worksheet: ${selectedMonth}`}
                </h3>

                {/* Desktop view (Hidden on mobile) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        <th className="py-3 px-2">{isLao ? 'ຊື່ພະນັກງານ' : 'Staff Member'}</th>
                        <th className="py-3 px-2 text-center">{isLao ? 'ວັນເຮັດວຽກ' : 'Days'}</th>
                        <th className="py-3 px-2 text-center">{isLao ? 'ໂມງປົກກະຕິ' : 'Reg Hrs'}</th>
                        <th className="py-3 px-2 text-center text-red-500">OT Hrs</th>
                        <th className="py-3 px-3 text-right">{isLao ? 'ໂບນັດ (LAK)' : 'Bonus'}</th>
                        <th className="py-3 px-3 text-right text-rose-500">{isLao ? 'ຫັກເງິນ (LAK)' : 'Deduct'}</th>
                        <th className="py-3 px-3 text-right text-blue-500">{isLao ? 'ຄ່າຈ້າງລວມ' : 'Total Payout'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-white/5 text-slate-700 dark:text-white">
                      {monthlyPayroll.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-white/5 text-xs transition-colors">
                          <td className="py-3 px-2">
                            <div className="flex flex-col">
                              <span className="font-bold">{p.name}</span>
                              <span className="text-[9px] opacity-50 uppercase tracking-widest font-black mt-0.5 flex items-center gap-1.5 flex-wrap">
                                {p.position}
                                {(p as any).avgEffort && (
                                  <span className="bg-amber-550/10 text-amber-600 dark:text-amber-400 font-bold px-1 rounded flex items-center gap-0.5 scale-90 origin-left">
                                    ⚡ Effort: {(p as any).avgEffort}/10 {(p as any).totalTasks > 0 ? `(${(p as any).totalTasks} tasks)` : ''}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-center font-bold">{p.daysWorked}</td>
                          <td className="py-3 px-2 text-center font-medium">{p.regularHours}</td>
                          <td className="py-3 px-2 text-center text-red-500 font-bold">{p.overtimeHours > 0 ? p.overtimeHours : '-'}</td>
                          
                          {/* Bonus adjustment field */}
                          <td className="py-3 px-3 text-right">
                            <input
                              type="number"
                              value={p.bonus || ''}
                              placeholder="0"
                              onChange={e => updateAdjustment(p.id, 'bonus', Number(e.target.value))}
                              className="w-20 text-right bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-green-500 font-black p-1 rounded-md border-0 focus:ring-1 focus:ring-green-300 text-xs"
                            />
                          </td>

                          {/* Deduction adjustment field */}
                          <td className="py-3 px-3 text-right">
                            <input
                              type="number"
                              value={p.deduction || ''}
                              placeholder="0"
                              onChange={e => updateAdjustment(p.id, 'deduction', Number(e.target.value))}
                              className="w-20 text-right bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-rose-500 font-black p-1 rounded-md border-0 focus:ring-1 focus:ring-rose-300 text-xs"
                            />
                          </td>

                          <td className="py-3 px-3 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-[13px] font-black text-blue-600 dark:text-blue-300">
                                {Math.round(p.totalPayout).toLocaleString()}₭
                              </span>
                              <span className="text-[8px] opacity-40 font-mono mt-0.5">
                                Rate: {p.hourlyRate?.toLocaleString()}₭
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile view (Stacked interactive cards with roomy touch targets) */}
                <div className="block md:hidden space-y-4">
                  {monthlyPayroll.map(p => (
                    <div key={p.id} className="p-4 bg-slate-50 dark:bg-[#052659]/50 border border-slate-100 dark:border-white/10 rounded-2xl space-y-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-black text-slate-800 dark:text-white leading-tight truncate">{p.name}</h4>
                          <span className="text-[9px] opacity-50 uppercase tracking-widest font-black mt-1 flex items-center gap-1.5 flex-wrap">
                            {p.position} ({p.id})
                            {(p as any).avgEffort && (
                              <span className="bg-amber-550/10 text-amber-600 dark:text-amber-400 font-bold px-1 rounded flex items-center gap-0.5 scale-90 origin-left">
                                ⚡ E: {(p as any).avgEffort}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-black text-blue-600 dark:text-sky-305">
                            {Math.round(p.totalPayout).toLocaleString()}₭
                          </span>
                          <p className="text-[8px] text-slate-400 opacity-60 font-mono mt-0.5">Rate: {p.hourlyRate?.toLocaleString()}₭/Hr</p>
                        </div>
                      </div>

                      {/* Stats brief row */}
                      <div className="grid grid-cols-3 gap-2 bg-white dark:bg-[#073069]/60 p-2.5 rounded-xl border border-slate-100 dark:border-white/5 text-center">
                        <div>
                          <span className="text-[9px] text-slate-400 font-bold uppercase block">{isLao ? 'ວັນເຮັດວຽກ' : 'Days'}</span>
                          <span className="text-xs font-black text-[#052659] dark:text-amber-400">{p.daysWorked}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-400 font-bold uppercase block">{isLao ? 'ຊມ' : 'Hrs'}</span>
                          <span className="text-xs font-black text-[#052659] dark:text-amber-400">{p.regularHours}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-400 font-bold uppercase block">OT Hrs</span>
                          <span className={`text-xs font-black ${p.overtimeHours > 0 ? 'text-red-500' : 'text-slate-300'}`}>
                            {p.overtimeHours > 0 ? p.overtimeHours : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Direct inline adjustment forms - optimized for mobile single click */}
                      <div className="grid grid-cols-2 gap-3 pb-1">
                        <div>
                          <label className="text-[9.5px] font-black uppercase text-emerald-600 dark:text-emerald-400 block mb-1">
                            {isLao ? 'ໂບນັດ (+ LAK)' : 'Bonus (+ LAK)'}
                          </label>
                          <input
                            type="number"
                            value={p.bonus || ''}
                            placeholder="0"
                            onChange={e => updateAdjustment(p.id, 'bonus', Number(e.target.value))}
                            className="w-full text-center bg-white dark:bg-[#073069] text-emerald-500 font-black p-2 rounded-xl border border-slate-200 dark:border-white/10 focus:ring-2 focus:ring-emerald-300 text-xs min-h-[44px]"
                          />
                        </div>
                        <div>
                          <label className="text-[9.5px] font-black uppercase text-rose-500 block mb-1">
                            {isLao ? 'ຫັກເງິນ (- LAK)' : 'Deduct (- LAK)'}
                          </label>
                          <input
                            type="number"
                            value={p.deduction || ''}
                            placeholder="0"
                            onChange={e => updateAdjustment(p.id, 'deduction', Number(e.target.value))}
                            className="w-full text-center bg-white dark:bg-[#073069] text-rose-500 font-black p-2 rounded-xl border border-slate-200 dark:border-white/10 focus:ring-2 focus:ring-rose-300 text-xs min-h-[44px]"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attendance Log List */}
              <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm p-6 overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-[#052659] dark:text-white">
                      {isLao ? `ບັນທຶກເວລາທັງໝົດໃນເດືອນ: ${selectedMonth}` : `Raw Roster Timelogs: ${selectedMonth}`}
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {isLao ? 'ສະແດງການລົງເວລາ, ຊົ່ວໂມງເຮັດວຽກຈິງ ແລະ ການຄິດໄລ່ OT ປະຈຳວັນ' : 'Daily timetables, actual clocked hours and dynamic premium rates'}
                    </p>
                  </div>

                  {/* Attendance quick search/filters & Sheet Fetcher Button */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={fetchFromGoogleSheet}
                      disabled={syncStatus === 'loading'}
                      className="h-8 px-3 text-[10px] font-black uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center gap-1.5 transition-all shadow-sm active:scale-95 border-0"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      {syncStatus === 'loading' 
                        ? (isLao ? 'ກຳລັງໂຫລດ...' : 'Refreshing...') 
                        : (isLao ? 'ດຶງຂໍ້ມູນການເຂົ້າວຽກ' : 'Sync Roster Logs')
                      }
                    </button>

                    <div className="relative">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder={isLao ? 'ຄົ້ນຫາຊື່...' : 'Search logs...'}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="h-8 pl-8 pr-3 text-xs bg-slate-100 dark:bg-[#052659] border-0 rounded-lg focus:ring-2 focus:ring-blue-500 text-slate-700 dark:text-white"
                      />
                    </div>
                    
                    <select
                      value={filterEmployeeId}
                      onChange={e => setFilterEmployeeId(e.target.value)}
                      className="h-8 text-xs bg-slate-100 dark:bg-[#052659] border-0 rounded-lg text-slate-700 dark:text-white px-2 focus:outline-none"
                    >
                      <option value="all">{isLao ? 'ພະນັກງານທັງໝົດ' : 'All Staff'}</option>
                      {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                  {filteredAttendance.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 dark:bg-white/5 rounded-2xl">
                      <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                        {isLao ? 'ບໍ່ພົບຂໍ້ມູນເວລາເຮັດວຽກໃນເງື່ອນໄຂນີ້' : 'No clock logs found.'}
                      </p>
                    </div>
                  ) : (
                    filteredAttendance.map(att => {
                      const emp = employees.find(e => e.id === att.employeeId);
                      const cal = getAttendanceCalculation(att, emp);

                      return (
                        <div key={att.id} className="p-3.5 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-slate-700 dark:text-white">
                          
                          {/* Name and Basic Checked block */}
                          <div className="flex items-start gap-3">
                            <div className="p-2 bg-blue-50 dark:bg-[#052659] rounded-xl shrink-0">
                              <UserCheck className="w-5 h-5 text-blue-500" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[8px] font-black uppercase bg-blue-500/10 text-blue-500 px-1 py-0.5 rounded shrink-0">{att.employeeId}</span>
                                <span className="text-xs font-bold leading-none">{att.employeeName}</span>
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] opacity-60">
                                <span className="font-bold text-slate-600 dark:text-slate-300">{att.date}</span>
                                <span>•</span>
                                <span>{att.checkIn} - {att.checkOut}</span>
                                {att.notes && (
                                  <>
                                    <span>•</span>
                                    <span className="italic">"{att.notes}"</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Calculations & Overtime block */}
                          <div className="flex items-center gap-4 border-t md:border-t-0 border-slate-200/50 pt-3 md:pt-0 shrink-0 justify-between md:justify-end">
                            
                            {/* Hour breakdown pill */}
                            <div className="text-right">
                              <p className="text-xs font-black">
                                {cal.totalHours} <span className="text-[9px] opacity-60 font-bold">{isLao ? 'ຊົ່ວໂມງ' : 'total hrs'}</span>
                              </p>
                              <p className="text-[9px] font-bold text-red-500 flex items-center gap-0.5 justify-end mt-0.5">
                                {cal.overtimeHours > 0 ? (
                                  <>
                                    <TrendingUp className="w-2.5 h-2.5" />
                                    OT: {cal.overtimeHours} {isLao ? 'ຊມ' : 'hrs'}
                                  </>
                                ) : (
                                  <span className="opacity-40">{isLao ? 'ເວລາປົກກະຕິ' : 'standard'}</span>
                                )}
                              </p>
                            </div>

                            {/* Calculated Pay */}
                            <div className="text-right">
                              <p className="text-xs font-black text-blue-600 dark:text-blue-300">
                                +{Math.round(cal.totalPay).toLocaleString()} ₭
                              </p>
                              <p className="text-[8px] opacity-50 font-bold uppercase tracking-widest mt-0.5">
                                {isLao ? 'ຄ່າຈ້າງລວມ' : 'Shift Earned'}
                              </p>
                            </div>

                            {/* Delete action */}
                            <button
                              onClick={() => {
                                if (confirm(isLao ? 'ຕ້ອງການລົບລາຍການນີ້?' : 'Delete this attendance log?')) {
                                  setAttendance(prev => prev.filter(a => a.id !== att.id));
                                }
                              }}
                              className="p-1 px-1.5 text-slate-300 hover:text-red-500 transition-colors focus:outline-none"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {activeSectionTab === 'leaves' && (
            <div className="space-y-6">
              {/* Absence / Leaves Main Control Bar */}
              <div className="bg-white dark:bg-[#073069] rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm p-6 overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-[#052659] dark:text-white">
                      {isLao ? `ຕິດຕາມການຂາດວຽກ ແລະ ໃບລາ: ${selectedMonth}` : `Staff Absences & Leave Records: ${selectedMonth}`}
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-1 font-bold">
                      {isLao 
                        ? 'ບັນທຶກສະຖິຕິການລາປ່ວຍ, ລາກິດ, ຫຼື ຂາດວຽກໂດຍບໍ່ມີເຫດຜົນ ເພື່ອນຳໄປຫັກອອກຈາກວັນເຮັດວຽກທີ່ຄາດຫວັງ' 
                        : 'Register medical leaves, authorized personal leaves, or unexcused absent counts to automatically deduce expected duty days.'}
                    </p>
                  </div>

                  <button 
                    onClick={() => setIsAddingLeave(!isAddingLeave)}
                    className="h-8 px-3 text-[10px] font-black uppercase tracking-widest bg-amber-500 hover:bg-amber-600 text-white rounded-lg flex items-center gap-1.5 transition-all shadow"
                  >
                    <Plus className="w-4 h-4" />
                    {isLao ? 'ບັນທຶກການຂາດວຽກ / ໃບລາ' : 'Log Leave / Absence'}
                  </button>
                </div>

                {/* Log Absence Form Section */}
                {isAddingLeave && (
                  <form onSubmit={handleAddLeave} className="mb-6 p-4 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#052659] dark:text-white border-b border-slate-200/50 pb-1">
                      {isLao ? 'ເພີ່ມຂໍ້ມູນການລາ / ຂາດວຽກ' : 'Onboard Absence Information'}
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ເລືອກພະນັກງານ' : 'Select Employee'}</label>
                        <select
                          value={newLeave.employeeId || ''}
                          onChange={e => setNewLeave(p => ({...p, employeeId: e.target.value}))}
                          className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                          required
                        >
                          <option value="">{isLao ? '-- ເລືອກພະນັກງານ --' : '-- Choose employee --'}</option>
                          {employees.map(e => (
                            <option key={e.id} value={e.id}>{e.name} ({e.id})</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ວັນທີ' : 'Date'}</label>
                        <input 
                          type="date" 
                          value={newLeave.date || ''}
                          onChange={e => setNewLeave(p => ({...p, date: e.target.value}))}
                          className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ປະເພດການຢຸດ' : 'Absence/Leave Type'}</label>
                        <select
                          value={newLeave.type || 'sick'}
                          onChange={e => setNewLeave(p => ({...p, type: e.target.value as any}))}
                          className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-1.5 focus:outline-none"
                          required
                        >
                          <option value="sick">{isLao ? 'ລາປ່ວຍ (Sick Leave)' : 'Sick Leave'}</option>
                          <option value="personal">{isLao ? 'ລາກິດ (Personal Leave)' : 'Personal Leave'}</option>
                          <option value="unexcused">{isLao ? 'ຂາດວຽກໂດຍບໍ່ມີເຫດຜົນ (Unexcused Absence)' : 'Unexcused Absence'}</option>
                          <option value="annual">{isLao ? 'ລາພັກຮ້ອນ/ພັກສົກປົກກະຕິ (Annual Leave)' : 'Annual Leave'}</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">{isLao ? 'ເຫດຜົນ / ໝາຍເຫດ (ມີເຫດຜົນບໍ່)' : 'Reason / Justification'}</label>
                        <input 
                          type="text" 
                          placeholder={isLao ? 'ເປັນໄຂ້ຫວັດໃຫຍ່, ເອກະສານຢັ້ງຢືນແພດ / ຕິດຕາມງານ' : 'Fever, checkup doc note'}
                          value={newLeave.reason || ''}
                          onChange={e => setNewLeave(p => ({...p, reason: e.target.value}))}
                          className="w-full text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <button type="submit" className="flex-1 py-1.5 text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors border-0">
                        {isLao ? 'ບັນທຶກຂໍ້ມູນ' : 'Register Leaves'}
                      </button>
                      <button type="button" onClick={() => setIsAddingLeave(false)} className="flex-1 py-1.5 text-[10px] font-bold bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-lg transition-colors border-0">
                        {isLao ? 'ຍົກເລີກ' : 'Cancel'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Leave List Table */}
                {/* Leave List Table */}
                {/* Desktop View (hidden on mobile) */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5 text-[10px] font-black uppercase text-slate-400 tracking-wider">
                        <th className="py-3 px-2">{isLao ? 'ຊື່ພະນັກງານ' : 'Staff Member'}</th>
                        <th className="py-3 px-2 text-center">{isLao ? 'ວັນທີ' : 'Date'}</th>
                        <th className="py-3 px-2 text-center">{isLao ? 'ປະເພດການລາ' : 'Leave Type'}</th>
                        <th className="py-3 px-3">{isLao ? 'ເຫດຜົນ (ມີເຫດຜົນບໍ່)' : 'Reason & Details'}</th>
                        <th className="py-3 px-2 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-white/5 text-slate-700 dark:text-white">
                      {leaveLogs.filter(lv => lv.date.startsWith(selectedMonth)).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-xs text-slate-400 font-bold uppercase tracking-wider">
                            {isLao ? 'ບໍ່ມີຂໍ້ມູນການຢຸດ/ຂາດວຽກໃນເດືອນນີ້' : 'No absence/leave recorded for this month.'}
                          </td>
                        </tr>
                      ) : (
                        leaveLogs.filter(lv => lv.date.startsWith(selectedMonth)).map(lv => (
                          <tr key={lv.id} className="hover:bg-slate-50 dark:hover:bg-white/5 text-xs transition-colors">
                            <td className="py-3 px-2 font-bold">{lv.employeeName}</td>
                            <td className="py-3 px-2 text-center font-mono opacity-80">{lv.date}</td>
                            <td className="py-3 px-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                lv.type === 'sick' ? 'bg-red-500/10 text-red-500' :
                                lv.type === 'personal' ? 'bg-blue-500/10 text-blue-500' :
                                lv.type === 'annual' ? 'bg-emerald-500/10 text-emerald-500' :
                                'bg-rose-500/15 text-rose-600 font-black'
                              }`}>
                                {lv.type === 'sick' ? (isLao ? 'ລາປ່ວຍ (Sick)' : 'Sick') :
                                 lv.type === 'personal' ? (isLao ? 'ລາກິດ (Personal)' : 'Personal') :
                                 lv.type === 'annual' ? (isLao ? 'ລາພັກຮ້ອນ (Annual)' : 'Annual') :
                                 (isLao ? 'ຂາດວຽກ (Absent)' : 'Absent')}
                              </span>
                            </td>
                            <td className="py-3 px-3 italic opacity-85 font-bold">"{lv.reason}"</td>
                            <td className="py-3 px-2 text-right">
                              <button
                                onClick={() => {
                                  if (confirm(isLao ? 'ຕ້ອງການລົບໃບຢຸດນີ້?' : 'Delete this absence logs?')) {
                                    setLeaveLogs(prev => prev.filter(l => l.id !== lv.id));
                                  }
                                }}
                                className="p-1 px-1.5 text-slate-300 hover:text-red-500 transition-colors focus:outline-none border-0 bg-transparent"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View (stacked cards with generous tap targets, no horizontal scrolling) */}
                <div className="block md:hidden space-y-3">
                  {leaveLogs.filter(lv => lv.date.startsWith(selectedMonth)).length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 dark:bg-white/5 rounded-2xl">
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                        {isLao ? 'ບໍ່ມີຂໍ້ມູນການຢຸດ/ຂາດວຽກໃນເດືອນນີ້' : 'No absence/leave recorded for this month.'}
                      </p>
                    </div>
                  ) : (
                    leaveLogs.filter(lv => lv.date.startsWith(selectedMonth)).map(lv => (
                      <div key={lv.id} className="p-4 bg-slate-50 dark:bg-[#052659]/50 border border-slate-100 dark:border-white/10 rounded-2xl flex flex-col gap-2.5 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="text-xs font-black text-slate-800 dark:text-white truncate">{lv.employeeName}</h4>
                            <span className="text-[9px] text-slate-400 font-mono mt-0.5 block">{lv.date}</span>
                          </div>
                          
                          <button
                            onClick={() => {
                              if (confirm(isLao ? 'ຕ້ອງການລົບໃບຢຸດນີ້?' : 'Delete this absence logs?')) {
                                setLeaveLogs(prev => prev.filter(l => l.id !== lv.id));
                              }
                            }}
                            className="p-2 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 rounded-xl transition-colors shrink-0 border-0 flex items-center justify-center min-h-[44px] min-w-[44px]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between text-[11px] gap-2 pt-1">
                          <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider ${
                            lv.type === 'sick' ? 'bg-red-500/10 text-red-500' :
                            lv.type === 'personal' ? 'bg-blue-500/10 text-blue-500' :
                            lv.type === 'annual' ? 'bg-emerald-500/10 text-emerald-500' :
                            'bg-rose-500/15 text-rose-600'
                          }`}>
                            {lv.type === 'sick' ? (isLao ? 'ລາປ່ວຍ (Sick)' : 'Sick') :
                             lv.type === 'personal' ? (isLao ? 'ລາກິດ (Personal)' : 'Personal') :
                             lv.type === 'annual' ? (isLao ? 'ລາພັກຮ້ອນ (Annual)' : 'Annual') :
                             (isLao ? 'ຂາດວຽກ (Absent)' : 'Absent')}
                          </span>
                        </div>

                        <p className="text-[11px] bg-white dark:bg-[#073069]/60 p-2.5 rounded-xl border border-slate-150 dark:border-white/5 italic text-slate-500 dark:text-slate-300">
                          "{lv.reason}"
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* 1. EMPLOYEE PROFILE & HISTORY MODAL */}
      {selectedEmployeeForProfile && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-100 dark:border-white/10 w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-blue-600 to-[#052659] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 text-white px-2 py-0.5 rounded">
                  {selectedEmployeeForProfile.id}
                </span>
                <h3 className="text-xl font-black mt-1">{selectedEmployeeForProfile.name}</h3>
                <p className="text-xs opacity-80 font-semibold">{selectedEmployeeForProfile.position}</p>
              </div>
              <button 
                onClick={() => setSelectedEmployeeForProfile(null)}
                className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white focus:outline-none border-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Contents */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 min-h-0 text-slate-700 dark:text-white">
              
              {/* Quick Configuration Inputs Grid (Allows inline updates) */}
              <div className="bg-slate-50 dark:bg-white/5 p-4 rounded-2xl border border-slate-100 dark:border-white/5 space-y-4">
                <p className="text-[11px] font-black uppercase tracking-wider text-blue-500 border-b border-slate-200/50 dark:border-white/5 pb-1 font-bold">
                  {isLao ? 'ແກ້ໄຂຖານເງິນເດືອນ ແລະ ການຄິດໄລ່ OT' : 'Adjust Base Salary & OT Calculations'}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      {isLao ? 'ຖານເງິນເດືອນພື້ນຖານ (LAK)' : 'Base Salary (LAK)'}
                    </label>
                    <input 
                      type="number" 
                      value={selectedEmployeeForProfile.baseSalary || 0}
                      onChange={e => handleOverrideFieldChange('baseSalary', Number(e.target.value))}
                      className="w-full text-xs font-black bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none text-slate-700 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      {isLao ? 'ຄ່າຈ້າງຕໍ່ຊົ່ວໂມງ (LAK/Hr)' : 'Hourly Wage Rate'}
                    </label>
                    <input 
                      type="number" 
                      value={selectedEmployeeForProfile.hourlyRate || 0}
                      onChange={e => handleOverrideFieldChange('hourlyRate', Number(e.target.value))}
                      className="w-full text-xs font-black bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none text-slate-700 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      {isLao ? 'ວັນເຮັດວຽກທີ່ຄາດຫວັງ/ເດືອນ' : 'Expected Duty Days/Month'}
                    </label>
                    <input 
                      type="number" 
                      value={selectedEmployeeForProfile.expectedWorkDays !== undefined ? selectedEmployeeForProfile.expectedWorkDays : 26}
                      onChange={e => handleOverrideFieldChange('expectedWorkDays', Number(e.target.value))}
                      className="w-full text-xs font-black bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none text-slate-700 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      {isLao ? 'ວິທີຄິດໄລ່ OT ສະເພາະບຸກຄົນ' : 'Employee OT Calculation Setup'}
                    </label>
                    <div className="flex gap-1 bg-white dark:bg-[#052659] p-1 rounded-lg border border-slate-200 dark:border-white/10">
                      <button
                        type="button"
                        onClick={() => handleOverrideFieldChange('otCalcType', 'multiplier')}
                        className={`flex-1 text-[9px] font-bold py-1 rounded transition-colors border-0 ${selectedEmployeeForProfile.otCalcType === 'multiplier' ? 'bg-blue-500 text-white font-bold' : 'text-slate-400 bg-transparent'}`}
                      >
                        {isLao ? 'ອັດຕາຄູນ' : 'Multiplier'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOverrideFieldChange('otCalcType', 'flat')}
                        className={`flex-1 text-[9px] font-bold py-1 rounded transition-colors border-0 ${selectedEmployeeForProfile.otCalcType === 'flat' ? 'bg-blue-500 text-white font-bold' : 'text-slate-400 bg-transparent'}`}
                      >
                        {isLao ? 'ຄົງທີ່ຕໍ່ ຊມ' : 'Flat LAK'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-slate-200/50 dark:border-white/5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      {selectedEmployeeForProfile.otCalcType === 'multiplier' 
                        ? (isLao ? 'ອັດຕາການຄູນ OT (ເຊັ່ນ: 1.5)' : 'OT Multiplier Value (e.g. 1.5)')
                        : (isLao ? 'ຄ່າຈ້າງ OT ຄົງທີ່ຕໍ່ຊົ່ວໂມງ (LAK)' : 'OT Flat LAK Rate/Hour')
                      }
                    </label>
                    <input 
                      type="number" 
                      step={selectedEmployeeForProfile.otCalcType === 'multiplier' ? '0.1' : '5000'}
                      value={selectedEmployeeForProfile.otRateValue !== undefined ? selectedEmployeeForProfile.otRateValue : 1.5}
                      onChange={e => handleOverrideFieldChange('otRateValue', Number(e.target.value))}
                      className="w-full text-xs font-black bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none text-slate-700 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      {isLao ? 'ກະການເຮັດວຽກ' : 'Shift Type'}
                    </label>
                    <select
                      value={selectedEmployeeForProfile.shiftType || 'shift1'}
                      onChange={e => handleOverrideFieldChange('shiftType', e.target.value)}
                      className="w-full text-xs font-black bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-lg p-2 focus:outline-none text-slate-700 dark:text-white"
                    >
                      <option value="shift1">{isLao ? 'ກະ 1: 07:00 - 16:00 (ມີ OT)' : 'Shift 1: 07:00 - 16:00 (with OT)'}</option>
                      <option value="shift2">{isLao ? 'ກະ 2: 11:30 - 20:00 (ມີ OT)' : 'Shift 2: 11:30 - 20:00 (with OT)'}</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/50 dark:border-white/5 flex items-center justify-between text-[10px] text-slate-400 font-bold">
                  <div>
                    {isLao 
                      ? 'ແກ້ໄຂຂໍ້ມູນຖານເງິນເດືອນ ແລະ ກະການເຮັດວຽກຢູ່ເທິງນີ້ແລ້ວ ລະບົບຈະບັນທຶກໄວ້ໃນເຄື່ອງທັນທີ.' 
                      : 'Values and shift settings updated here are saved onto offline cache instantly.'}
                  </div>
                </div>
              </div>

              {/* Roster & Time logs section */}
              <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-[#052659] dark:text-white flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-blue-500" />
                  {isLao ? `ປະຫວັດການມາວຽກປະຈຳເດືອນ (${selectedMonth})` : `Attendance history for (${selectedMonth})`}
                </p>

                <div className="space-y-2 max-h-[200px] overflow-y-auto border border-slate-100 dark:border-white/5 rounded-2xl p-3 bg-slate-50 dark:bg-[#052659]/30">
                  {attendance.filter(att => att.employeeId === selectedEmployeeForProfile.id && att.date.startsWith(selectedMonth)).length === 0 ? (
                    <p className="text-center py-6 text-xs text-slate-400 font-bold uppercase tracking-wider">
                      {isLao ? 'ບໍ່ພົບປະຫວັດການລົງເວລາໃນເດືອນນີ້' : 'No clock logs found.'}
                    </p>
                  ) : (
                    attendance.filter(att => att.employeeId === selectedEmployeeForProfile.id && att.date.startsWith(selectedMonth)).map(att => {
                      const cal = getAttendanceCalculation(att, selectedEmployeeForProfile);
                      return (
                        <div key={att.id} className="p-2 bg-white dark:bg-[#073069] border border-slate-100 dark:border-white/5 rounded-xl flex items-center justify-between text-xs font-bold shadow-sm">
                          <div>
                            <span className="text-blue-500 mr-2">{att.date}</span>
                            <span className="opacity-70 font-normal">({att.checkIn} - {att.checkOut})</span>
                          </div>
                          <div className="text-right">
                            <span className="font-black text-[#052659] dark:text-white">{cal.totalHours} Hrs </span>
                            {cal.overtimeHours > 0 && <span className="text-red-500 text-[10px] font-black pointer-events-none">(OT: {cal.overtimeHours})</span>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Leaves & Absences section for the employee */}
              <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-wider text-[#052659] dark:text-white flex items-center gap-1.5">
                  <CalendarIcon className="w-4 h-4 text-amber-500" />
                  {isLao ? `ປະຫວັດການຂາດວຽກ/ລາກິດໃນເດືອນ (${selectedMonth})` : `History of Absences & Leaves (${selectedMonth})`}
                </p>

                <div className="space-y-2 max-h-[180px] overflow-y-auto border border-slate-100 dark:border-white/5 rounded-2xl p-4 bg-slate-50 dark:bg-[#052659]/30">
                  {leaveLogs.filter(lv => lv.employeeId === selectedEmployeeForProfile.id && lv.date.startsWith(selectedMonth)).length === 0 ? (
                    <p className="text-center py-4 text-xs text-slate-400 font-bold uppercase tracking-wider">
                      {isLao ? 'ບໍ່ມີປະຫວັດການຂາດວຽກ ຫຼື ລາກິດໃນເດືອນນີ້' : 'No absences/leaves logged.'}
                    </p>
                  ) : (
                    leaveLogs.filter(lv => lv.employeeId === selectedEmployeeForProfile.id && lv.date.startsWith(selectedMonth)).map(lv => (
                      <div key={lv.id} className="p-2.5 bg-white dark:bg-[#073069] border border-slate-100 dark:border-white/5 rounded-xl flex items-center justify-between text-xs shadow-sm">
                        <div className="min-w-0 flex-1">
                          <span className="text-amber-600 font-bold mr-2">{lv.date}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                            lv.type === 'sick' ? 'bg-red-500/10 text-red-500' :
                            lv.type === 'personal' ? 'bg-blue-500/10 text-blue-500' :
                            lv.type === 'annual' ? 'bg-emerald-500/10 text-emerald-500' :
                            'bg-rose-500/15 text-rose-600'
                          }`}>
                            {lv.type === 'sick' ? (isLao ? 'ລາປ່ວຍ' : 'Sick') :
                             lv.type === 'personal' ? (isLao ? 'ລາກິດ' : 'Personal') :
                             lv.type === 'annual' ? (isLao ? 'ລາພັກຮ້ອນ' : 'Annual') :
                             (isLao ? 'ຂາດວຽກ' : 'Absent')}
                          </span>
                          <p className="text-[10px] italic text-slate-400 mt-1 truncate">"{lv.reason}"</p>
                        </div>
                        
                        <button
                          onClick={() => setLeaveLogs(prev => prev.filter(l => l.id !== lv.id))}
                          className="text-slate-300 hover:text-red-500 p-1 rounded border-0 bg-transparent"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/5 flex justify-end">
              <button 
                onClick={() => setSelectedEmployeeForProfile(null)}
                className="px-5 py-2 text-xs font-black uppercase tracking-wider bg-slate-200 dark:bg-white/10 hover:bg-slate-300 text-slate-700 dark:text-slate-200 rounded-xl transition-all border-0"
              >
                {isLao ? 'ປິດໜ້າຕ່າງ' : 'Close Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ADVANCED PAYROLL COMPUTATION & PDF STATEMENT MODAL */}
      {isPayrollModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#073069] rounded-3xl border border-slate-100 dark:border-white/10 w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-emerald-600 to-[#052659] text-white flex items-center justify-between shadow-md">
              <div className="flex items-center gap-3">
                <CircleDollarSign className="w-8 h-8 text-emerald-300 animate-pulse" />
                <div>
                  <h3 className="text-xl font-black">{isLao ? 'ລາຍງານການຄິດໄລ່ເງິນເດືອນ Advanced' : 'Advanced Interactive Payroll Calculations Statement'}</h3>
                  <p className="text-xs opacity-90 font-bold uppercase tracking-widest mt-0.5">{selectedMonth} • Comprehensive Accounting Ledger</p>
                </div>
              </div>
              <button 
                onClick={() => setIsPayrollModalOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white focus:outline-none border-0 bg-transparent"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Table Ledger */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 min-h-0 text-slate-700 dark:text-white" id="payroll-print-invoice-ledger">
              
              {/* Header with Shop Identity (La Dolce Cafe & Co-working) */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-slate-900 dark:border-amber-500/50 pb-5 uppercase tracking-wider">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-alice text-amber-600 dark:text-amber-400 tracking-widest font-black">LA DOLCE</span>
                    <span className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 py-0.5 rounded-full font-black tracking-widest">WORKSPACE</span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold normal-case">Vientiane, Lao P.D.R • Tel: +85620 77609857 • Boutique Café & Creative Studio</p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-[9px] text-slate-400 font-black tracking-widest leading-none">{isLao ? 'ປະເພດເອກະສານ' : 'DOCUMENT TYPE'}</p>
                  <p className="text-sm font-alice font-bold text-[#052659] dark:text-amber-300 mt-1">{isLao ? 'ລາຍງານລາຍລະອຽດເງິນເດືອນພະນັກງານ' : 'Monthly Employee Payroll Ledger Report'}</p>
                  <p className="text-[9px] font-mono text-slate-400 normal-case">Period: <span className="font-bold text-[#052659] dark:text-white">{selectedMonth}</span> • Generated: {new Date().toLocaleDateString()}</p>
                </div>
              </div>

              {/* Summary KPIs cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl p-4 transition-all">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{isLao ? 'ລວມບຸກຄະລາກອນ' : 'Total Headcount'}</p>
                  <p className="text-lg font-black text-[#052659] dark:text-amber-400">{monthlyPayroll.length} {isLao ? 'ຄົນ' : 'Staff'}</p>
                </div>
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl p-4 transition-all">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{isLao ? 'ຊົ່ວໂມງ OT ທີ່ເກີດຂຶ້ນ' : 'Total Overtime hours'}</p>
                  <p className="text-lg font-black text-rose-500">{summaryMetrics.overtimeHours.toLocaleString()} Hrs</p>
                </div>
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl p-4 transition-all">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{isLao ? 'ຄ່າໃຊ້ຈ່າຍໂບນັດລວມ' : 'Total Allowances'}</p>
                  <p className="text-lg font-black text-emerald-500">+{Math.round(summaryMetrics.totalBonus).toLocaleString()} LAK</p>
                </div>
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl p-4 transition-all">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{isLao ? 'ລວມຍອດຄ່າຈ້າງສຸດທິ' : 'Total Net Payroll Pay'}</p>
                  <p className="text-lg font-black text-blue-500 dark:text-sky-300">{Math.round(summaryMetrics.totalEarnings).toLocaleString()} LAK</p>
                </div>
              </div>

              {/* Master Payroll Matrix Table */}
              {/* Desktop and print view */}
              <div className="hidden md:block print:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm bg-white dark:bg-[#052659]/30">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100/90 dark:bg-[#052659] border-b border-slate-200 dark:border-white/10 text-[9px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      <th className="py-3 px-3">{isLao ? 'ລະຫັດ & ຊື່ພະນັກງານ' : 'ID & Employee Name'}</th>
                      <th className="py-3 px-2 text-center">{isLao ? 'ວັນທີມາວຽກ' : 'Days worked'}</th>
                      <th className="py-3 px-2 text-center">{isLao ? 'ໂມງມາວຽກ' : 'Reg Hrs'}</th>
                      <th className="py-3 px-2 text-center">{isLao ? 'ໂມງ OT' : 'OT Hours'}</th>
                      <th className="py-3 px-2 text-center">{isLao ? 'ຂາດ/ລາສາມັນ' : 'Leaves/Abs'}</th>
                      <th className="py-3 px-3 text-right">{isLao ? 'ເງິນເດືອນພື້ນຖານ' : 'Base salary'}</th>
                      <th className="py-3 px-3 text-right">{isLao ? 'ຄ່າລ່ວງເວລາ (OT LAK)' : 'OT pay'}</th>
                      <th className="py-3 px-3 text-right">{isLao ? 'ໂບນັດ (+)' : 'Bonus'}</th>
                      <th className="py-3 px-3 text-right text-rose-500">{isLao ? 'ຫັກເງິນ (-)' : 'Deducts'}</th>
                      <th className="py-3 px-3 text-right text-blue-600 dark:text-sky-350 font-black">{isLao ? 'ເງິນສຸດທິ (LAK)' : 'Net Pay'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                    {monthlyPayroll.map(p => {
                      const expectedDays = p.expectedDays;
                      const absentDays = Math.max(0, expectedDays - p.daysWorked);

                      // Get specific absence details for explanation text
                      const monthsLeavesObj = leaveLogs.filter(lv => lv.employeeId === p.id && lv.date.startsWith(selectedMonth));
                      const absentBulletDetails = monthsLeavesObj.length > 0 
                        ? monthsLeavesObj.map(lv => `${lv.date}: ${lv.type} ("${lv.reason}")`).join('; ')
                        : (absentDays > 0 ? (isLao ? 'ບໍ່ໄດ້ບັນທຶກເຫດຜົນໃນໃບລາ' : 'No recorded leave reason') : '');

                      return (
                        <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-white/5 font-medium transition-colors">
                          <td className="py-3 px-3">
                            <div className="flex flex-col">
                              <span className="font-bold">{p.name}</span>
                              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{p.position} ({p.id})</span>
                              {absentBulletDetails && (
                                <span className="text-[8px] text-amber-600 dark:text-amber-400 font-semibold italic mt-0.5 max-w-xs truncate" title={absentBulletDetails}>
                                  {isLao ? 'ລາຍລະອຽດການຂາດ/ລາ: ' : 'Leave notes: '}{absentBulletDetails}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2 text-center font-bold">
                            <div>{p.daysWorked} / {expectedDays}</div>
                            {p.otDays > 0 && (
                              <span className="text-[9px] block text-emerald-600 dark:text-emerald-400 font-extrabold">
                                (+{p.otDays} {isLao ? 'ມື້ OT' : 'OT Days'})
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">{p.regularHours}</td>
                          <td className="py-3 px-2 text-center text-red-500 font-bold">
                            {p.overtimeHours > 0 ? `${p.overtimeHours} Hrs` : '-'}
                          </td>
                          <td className="py-3 px-2 text-center font-bold">
                            <span className={absentDays > 0 ? 'text-red-500 font-black' : 'text-slate-400'}>
                              {absentDays} {isLao ? 'ມື້' : 'Days'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className="flex flex-col items-end">
                              <span className="font-bold">{Math.round(p.baseSalaryEarned).toLocaleString()}₭</span>
                              {p.baseSalary > 0 && p.baseSalaryEarned !== p.baseSalary && (
                                <span className="text-[8px] opacity-45 font-bold">Full: {p.baseSalary.toLocaleString()}₭</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-rose-500 font-bold">
                            <div className="flex flex-col items-end">
                              <span>+{Math.round(p.otPay + p.otDaysPay).toLocaleString()}₭</span>
                              {p.otDaysPay > 0 && (
                                <span className="text-[8px] opacity-75 text-amber-500 font-black">
                                  {isLao ? 'ມື້: ' : 'Days: '}+{Math.round(p.otDaysPay).toLocaleString()}₭
                                </span>
                              )}
                              {p.otPay > 0 && p.otDaysPay > 0 && (
                                <span className="text-[8px] opacity-75 text-rose-400 font-bold">
                                  {isLao ? 'ໂມງ: ' : 'Hrs: '}+{Math.round(p.otPay).toLocaleString()}₭
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-emerald-500">+{Math.round(p.bonus).toLocaleString()}₭</td>
                          <td className="py-3 px-3 text-right font-mono text-rose-600">-{Math.round(p.deduction).toLocaleString()}₭</td>
                          <td className="py-3 px-3 text-right font-mono text-blue-600 dark:text-sky-300 font-bold text-xs bg-blue-50/10">
                            {Math.round(p.totalPayout).toLocaleString()}₭
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile view (Stacked beautiful payroll cards context, non-scrolling) */}
              <div className="block md:hidden print:hidden space-y-4">
                {monthlyPayroll.map(p => {
                  const expectedDays = p.expectedDays;
                  const absentDays = Math.max(0, expectedDays - p.daysWorked);

                  // Get specific absence details for explanation text
                  const monthsLeavesObj = leaveLogs.filter(lv => lv.employeeId === p.id && lv.date.startsWith(selectedMonth));
                  const absentBulletDetails = monthsLeavesObj.length > 0 
                    ? monthsLeavesObj.map(lv => `${lv.date}: ${lv.type} ("${lv.reason}")`).join('; ')
                    : (absentDays > 0 ? (isLao ? 'ບໍ່ໄດ້ບັນທຶກເຫດຜົນໃນໃບລາ' : 'No recorded leave reason') : '');

                  return (
                    <div key={p.id} className="p-4 bg-slate-50 dark:bg-[#052659]/50 border border-slate-150 dark:border-white/10 rounded-2xl space-y-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2 border-b border-dashed border-slate-200 dark:border-white/5 pb-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-black text-[#052659] dark:text-amber-400 leading-tight truncate">{p.name}</h4>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-1">{p.position} ({p.id})</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-rose-700 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full inline-block mb-1">
                            {Math.round(p.totalPayout).toLocaleString()}₭
                          </span>
                          <p className="text-[8px] text-slate-400 uppercase tracking-widest">{isLao ? 'ເງິນສຸດທິ' : 'Net Pay'}</p>
                        </div>
                      </div>

                      {/* Brief statistics row */}
                      <div className="grid grid-cols-4 gap-1 p-2 bg-white dark:bg-[#073069]/60 rounded-xl text-center border border-slate-100 dark:border-white/5">
                        <div>
                          <p className="text-[8px] text-slate-400 font-bold uppercase">{isLao ? 'ວັນເຮັດວຽກ' : 'Days'}</p>
                          <p className="text-[10px] font-black text-slate-700 dark:text-white">
                            {p.daysWorked}/{expectedDays}
                            {p.otDays > 0 && <span className="text-[8px] text-emerald-500 block">+{p.otDays} OT</span>}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8px] text-slate-400 font-bold uppercase">{isLao ? 'ໂມງປົກກະຕិ' : 'Reg Hrs'}</p>
                          <p className="text-[10px] font-black text-slate-700 dark:text-white">{p.regularHours}</p>
                        </div>
                        <div>
                          <p className="text-[8px] text-slate-400 font-bold uppercase">OT Hrs</p>
                          <p className="text-[10px] font-black text-rose-500">{p.overtimeHours > 0 ? p.overtimeHours : '-'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] text-slate-400 font-bold uppercase">{isLao ? 'ຂາດວຽກ' : 'Absence'}</p>
                          <p className={`text-[10px] font-black ${absentDays > 0 ? 'text-rose-500' : 'text-slate-400'}`}>{absentDays}</p>
                        </div>
                      </div>

                      {/* Breakdown grid items */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] font-medium text-slate-650 dark:text-slate-350">
                        <div className="flex justify-between border-b border-dashed border-slate-200/50 dark:border-white/5 pb-10 sm:pb-1">
                          <span>{isLao ? 'ເງິນເດືອນພື້ນຖານ' : 'Base salary'}:</span>
                          <span className="font-mono text-slate-700 dark:text-white font-bold">{Math.round(p.baseSalaryEarned).toLocaleString()}₭</span>
                        </div>
                        <div className="flex justify-between border-b border-dashed border-slate-200/50 dark:border-white/5 pb-10 sm:pb-1">
                          <span>{isLao ? 'ຄ່າ OT' : 'OT Pay'}:</span>
                          <span className="font-mono text-rose-550 dark:text-rose-450 font-bold text-right">
                            <span>+{Math.round(p.otPay + p.otDaysPay).toLocaleString()}₭</span>
                            {p.otDaysPay > 0 && (
                              <span className="text-[8px] block text-right font-black text-amber-500">
                                ({isLao ? 'ມື້: ' : 'Days: '}+{Math.round(p.otDaysPay).toLocaleString()}₭)
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-dashed border-slate-200/50 dark:border-white/5 pb-10 sm:pb-1">
                          <span>{isLao ? 'ໂບນັດ' : 'Bonus'}:</span>
                          <span className="font-mono text-emerald-500 font-bold">+{Math.round(p.bonus).toLocaleString()}₭</span>
                        </div>
                        <div className="flex justify-between border-b border-dashed border-slate-200/50 dark:border-white/5 pb-10 sm:pb-1">
                          <span className="text-rose-500 font-bold">{isLao ? 'ຫັກເງິນ' : 'Deductions'}:</span>
                          <span className="font-mono text-rose-600 font-bold">-{Math.round(p.deduction).toLocaleString()}₭</span>
                        </div>
                      </div>

                      {absentBulletDetails && (
                        <div className="text-[9px] bg-amber-500/10 text-amber-800 dark:text-amber-300 p-2.5 rounded-xl border border-amber-500/15 leading-relaxed font-semibold">
                          <span className="font-bold">{isLao ? 'ລາຍລະອຽດຂາດ/ລາ:' : 'Leave details:'}</span> "{absentBulletDetails}"
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>


              {/* Explanatory notes & Signatures (Grid) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pt-4">
                {/* Rules Guidelines */}
                <div className="md:col-span-5 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-2xl p-4 space-y-2 text-[10px] font-semibold text-slate-400 leading-relaxed">
                  <p className="uppercase text-amber-600 dark:text-amber-400 font-black tracking-widest">{isLao ? 'ເຫດຜົນ ແລະ ກົດເກນການຄິດໄລ່ເງິນເດືອນ' : 'Governing Calculations Guidelines & Ledger notes'}</p>
                  <p>1. {isLao ? 'ກະ 1: ເວລາເຮັດວຽກແມ່ນ 07:00 ຫາ 16:00. ຖ້າເຂົ້າວຽກກ່ອນ 07:00 ແມ່ນຕັດເປັນ 07:00. ຖ້າກາຍ 16:00 ແມ່ນຄິດໄລ່ເປັນ OT.' : 'Shift 1: Standard hours are 07:00 to 16:00. Clock-ins before 07:00 are clamped to 07:00. Clock-outs past 16:00 are premium OT.'}</p>
                  <p>2. {isLao ? 'ກະ 2: ເວລາເຮັດວຽກແມ່ນ 11:30 ຫາ 20:00. ຖ້າເຂົ້າວຽກກ່ອນ 11:30 ແມ່ນຕັດເປັນ 11:30. ຖ້າກາຍ 20:00 ແມ່ນຄິດໄລ່ເປັນ OT.' : 'Shift 2: Standard hours are 11:30 to 20:00. Clock-ins before 11:30 are clamped to 11:30. Clock-outs past 20:00 are hourly OT.'}</p>
                  <p>3. {isLao ? 'ອັດຕາຄູນ OT ແມ່ນຄິດໄລ່ຕາມການຕັ້ງຄ່າສະເພາະຕົວຂອງພະນັກງານ ຫຼື ໃຊ້ອັດຕາຄູນພື້ນຖານ 1.5x ຂອງລະບົບທົ່ວໄປ.' : 'Individual OT is evaluated using the respective employee config or defaults directly to system 1.5x multipliers.'}</p>
                  <p>4. {isLao ? 'ຄິດໄລ່ວັນເຮັດວຽກ: ຖານ 6 ວັນ/ອາທິດ (26 ວັນ/ເດືອນ ໂດຍມີວັນພັກ 1 ວັນ/ອາທິດ). ຖ້າເຮັດວຽກເກີນ 6 ວັນ/ອາທິດ ຫຼື ເກີນ 26 ວັນ/ເດືອນ ສ່ວນທີ່ເກີນແມ່ນນັບເປັນວັນລ່ວງເວລາ (ມື້ OT) ໂດຍຄິດໄລ່ບວກເພີ່ມໃຫ້ພະນັກງານ.' : '4. Work Day Limits: Standard is 6 days/week (26 days/month with 1 day off/week). Working > 6 days/week or > 26 days/month classifies those excess days as Overtime Days (OT Days), which adds extra payout.'}</p>
                </div>

                {/* Hand-signed Accounting Records Verification Section */}
                <div className="md:col-span-7 grid grid-cols-3 gap-4 pt-4 uppercase text-[9px] font-black tracking-wider text-slate-500 dark:text-slate-300">
                  <div className="text-center flex flex-col justify-between h-40 bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl p-3">
                    <p className="font-bold text-amber-700 dark:text-amber-400">
                      {isLao ? 'ຜູ້ຈັດທຳ / Prepared By' : 'Prepared By'}
                    </p>
                    <div className="space-y-2">
                      <div className="border-b border-dashed border-slate-300 dark:border-white/20 w-24 mx-auto"></div>
                      <p className="text-[8px] opacity-75 font-semibold leading-none lowercase tracking-normal">
                        {isLao ? 'ວັນທີ / Date: ...............' : 'Date: ...............'}
                      </p>
                    </div>
                  </div>

                  <div className="text-center flex flex-col justify-between h-40 bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl p-3">
                    <p className="font-bold text-[#052659] dark:text-sky-300">
                      {isLao ? 'ຜູ້ກວດສອບ / Approved By' : 'Approved By'}
                    </p>
                    <div className="space-y-2">
                      <div className="border-b border-dashed border-slate-300 dark:border-white/20 w-24 mx-auto"></div>
                      <p className="text-[8px] opacity-75 font-semibold leading-none lowercase tracking-normal">
                        {isLao ? 'ວັນທີ / Date: ...............' : 'Date: ...............'}
                      </p>
                    </div>
                  </div>

                  <div className="text-center flex flex-col justify-between h-40 bg-slate-50/50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl p-3">
                    <p className="font-bold text-slate-500 dark:text-slate-400">
                      {isLao ? 'ຜູ້ຮັບເງິນ / Received By' : 'Received By'}
                    </p>
                    <div className="space-y-2">
                      <div className="border-b border-dashed border-slate-300 dark:border-white/20 w-24 mx-auto"></div>
                      <p className="text-[8px] opacity-75 font-semibold leading-none lowercase tracking-normal">
                        {isLao ? 'ວັນທີ / Date: ...............' : 'Date: ...............'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Modal Footer (Controls printable, copy, export actions) */}
            <div className="p-4 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handlePrintPayroll}
                  className="px-5 py-2.5 text-xs font-black uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white rounded-xl flex items-center gap-1.5 shadow transition-all border-0"
                >
                  <Printer className="w-4 h-4" />
                  {isLao ? 'ພິມ / ບັນທຶກເປັນ PDF' : 'Print Ledger Statement'}
                </button>

                <button
                  onClick={downloadPayrollCSV}
                  className="px-5 py-2.5 text-xs font-black uppercase tracking-wider bg-slate-700 hover:bg-slate-850 text-white rounded-xl flex items-center gap-1.5 shadow transition-all border-0"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {isLao ? 'ດຶງລາຍງານ Excel (CSV)' : 'Export Excel (CSV)'}
                </button>
              </div>

              <button 
                onClick={() => setIsPayrollModalOpen(false)}
                className="px-5 py-2.5 text-xs font-black uppercase tracking-wider bg-slate-200 dark:bg-white/10 hover:bg-slate-300 text-slate-700 dark:text-slate-200 rounded-xl transition-all border-0 animate-none"
              >
                {isLao ? 'ປິດໜ້າຕ່າງ' : 'Close Report'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
