import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, updateDoc, serverTimestamp 
} from 'firebase/firestore';
import { 
  Plus, Trash2, Edit3, Save, X, Search, Download, 
  Receipt, Image as ImageIcon, Upload, Eye, Wallet, CreditCard,
  Building2, TrendingUp, DollarSign, Calendar, Filter,
  ArrowUpRight, ArrowDownRight, Tag, AlertCircle, CheckCircle2,
  Clock, FileText, ArrowRightLeft, UserCheck, ShieldAlert, Check
} from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

export type DebtType = 'payable' | 'receivable'; // payable = ໜີ້ຕ້ອງສົ່ງ (Pending Expense), receivable = ໜີ້ຕ້ອງຮັບ (Pending Income)
export type PaymentChannel = 'Cash' | 'Onepay' | 'LDB';

export default function DebtLedger({ selectedBranch }: { selectedBranch?: string }) {
  const { t, i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'payable' | 'receivable'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Settlement Modal (Modal ຊຳລະໜີ້ / ຮັບເງິນໜີ້)
  const [settlingDebt, setSettlingDebt] = useState<any | null>(null);
  const [settleChannel, setSettleChannel] = useState<PaymentChannel>('Onepay');
  const [settleDate, setSettleDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [settlingLoading, setSettlingLoading] = useState(false);

  // Form State for New Debt
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  const [formData, setFormData] = useState({
    type: 'payable' as DebtType,
    partyName: '', // ຊື່ເຈົ້າໜີ້ ຫຼື ລູກໜີ້
    partyPhone: '',
    invoiceNo: '',
    amount: 0,
    category: 'Purchasing',
    issueDate: format(new Date(), 'yyyy-MM-dd'),
    dueDate: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'), // 7 days default
    remark: '',
    invoiceBase64: ''
  });

  const [displayAmount, setDisplayAmount] = useState('');

  const formatWithCommas = (val: string | number) => {
    const clean = String(val).replace(/,/g, '');
    if (!clean || isNaN(Number(clean))) return '';
    return Number(clean).toLocaleString();
  };

  // Clipboard image paste support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              compressAndSetImage(event.target?.result as string);
            };
            reader.readAsDataURL(blob);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Listen to Firestore Debts Collection
  useEffect(() => {
    const branch = selectedBranch || 'branch_1';
    const qDebts = query(collection(db, 'debts'), orderBy('dueDate', 'asc'));

    const unsubscribe = onSnapshot(qDebts, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDebts(all.filter((d: any) => (d.branchId || 'branch_1') === branch));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'debts');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [selectedBranch]);

  // Image compression to Base64
  const compressAndSetImage = (base64Str: string) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 1200;
      const scaleSize = MAX_WIDTH / img.width;
      canvas.width = img.width > MAX_WIDTH ? MAX_WIDTH : img.width;
      canvas.height = img.width > MAX_WIDTH ? (img.height * scaleSize) : img.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL('image/jpeg', 0.75);
      setFormData(prev => ({ ...prev, invoiceBase64: compressed }));
    };
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      compressAndSetImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Summary Metrics
  const summary = useMemo(() => {
    let totalPendingPayable = 0; // ໜີ້ຕ້ອງສົ່ງທີ່ຄ້າງຈ່າຍ
    let totalPendingReceivable = 0; // ໜີ້ຕ້ອງຮັບທີ່ຄ້າງຮັບ
    let settledPayableCount = 0;
    let settledReceivableCount = 0;

    debts.forEach(d => {
      const amt = Number(d.amount) || 0;
      if (d.status === 'pending') {
        if (d.type === 'payable') totalPendingPayable += amt;
        else totalPendingReceivable += amt;
      } else {
        if (d.type === 'payable') settledPayableCount++;
        else settledReceivableCount++;
      }
    });

    return {
      totalPendingPayable,
      totalPendingReceivable,
      settledPayableCount,
      settledReceivableCount
    };
  }, [debts]);

  // Save or Update Debt Record
  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.partyName.trim() || formData.amount <= 0) {
      alert(i18n.language === 'la' ? 'ກະລຸນາໃສ່ຊື່ ແລະ ຈຳນວນເງິນໃຫ້ຖືກຕ້ອງ' : 'Please provide party name and a valid amount');
      return;
    }

    try {
      setSaveLoading(true);
      const branchId = selectedBranch || 'branch_1';

      const debtData = {
        ...formData,
        branchId,
        status: 'pending',
        updatedAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com'
      };

      if (editingDebtId) {
        await updateDoc(doc(db, 'debts', editingDebtId), debtData);
        alert(i18n.language === 'la' ? 'ແກ້ໄຂຂໍ້ມູນໜີ້ສຳເລັດ!' : 'Debt updated successfully!');
      } else {
        await addDoc(collection(db, 'debts'), {
          ...debtData,
          createdAt: serverTimestamp()
        });
        alert(i18n.language === 'la' ? 'ບັນທຶກໜີ້ໃໝ່ສຳເລັດ!' : 'New debt logged successfully!');
      }

      setShowAddForm(false);
      setEditingDebtId(null);
      setFormData({
        type: 'payable',
        partyName: '',
        partyPhone: '',
        invoiceNo: '',
        amount: 0,
        category: 'Purchasing',
        issueDate: format(new Date(), 'yyyy-MM-dd'),
        dueDate: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
        remark: '',
        invoiceBase64: ''
      });
      setDisplayAmount('');
    } catch (err: any) {
      console.error("Debt save error:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  };

  // 🌟 ONE-CLICK SETTLEMENT: MARK AS SETTLED & PUSH TO FINANCE (ລາຍຮັບ/ລາຍຈ່າຍ)
  const handleExecuteSettlement = async () => {
    if (!settlingDebt) return;
    try {
      setSettlingLoading(true);
      const branchId = selectedBranch || 'branch_1';
      const timeNow = format(new Date(), 'HH:mm');

      // 1. Determine if this should be an Expense (Payable) or Income (Receivable)
      const isPayable = settlingDebt.type === 'payable';
      const txType = isPayable ? 'expense' : 'income';
      const defaultCategory = isPayable ? (settlingDebt.category || 'Purchasing') : 'Sales';
      
      const description = isPayable 
        ? `ຊຳລະໜີ້ໃຫ້ເຈົ້າໜີ້: ${settlingDebt.partyName} ${settlingDebt.invoiceNo ? `(#${settlingDebt.invoiceNo})` : ''}`
        : `ໄດ້ຮັບຊຳລະໜີ້ຈາກລູກໜີ້: ${settlingDebt.partyName} ${settlingDebt.invoiceNo ? `(#${settlingDebt.invoiceNo})` : ''}`;

      // 2. Add to Transactions Collection (Finance will immediately recognize this!)
      const txRef = await addDoc(collection(db, 'transactions'), {
        type: txType,
        amount: Number(settlingDebt.amount) || 0,
        category: defaultCategory,
        description,
        source: settleChannel,
        receiptUrl: settlingDebt.invoiceBase64 || '', // 👈 ແນບຮູບ Invoice Base64 ໄປພ້ອມເລີຍ!
        date: settleDate,
        time: timeNow,
        debtId: settlingDebt.id,
        partyName: settlingDebt.partyName,
        invoiceNo: settlingDebt.invoiceNo || '',
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        branchId
      });

      // 3. Mark Debt as Settled in Debts Collection
      await updateDoc(doc(db, 'debts', settlingDebt.id), {
        status: 'settled',
        settledDate: settleDate,
        settledChannel: settleChannel,
        settledTxId: txRef.id,
        updatedAt: serverTimestamp()
      });

      alert(i18n.language === 'la' 
        ? `ຊຳລະໜີ້ສຳເລັດ! ດຶງເຂົ້າເປັນ ${isPayable ? 'ລາຍຈ່າຍ (Expense)' : 'ລາຍຮັບ (Income)'} ໃນ Finance ຮຽບຮ້ອຍແລ້ວ!` 
        : `Settlement complete! Synchronized directly into Financials as an ${isPayable ? 'Expense' : 'Income'}!`);

      setSettlingDebt(null);
    } catch (err: any) {
      console.error("Settlement Error:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setSettlingLoading(false);
    }
  };

  // Delete Debt Record
  const handleDeleteDebt = async (id: string) => {
    if (!confirm(i18n.language === 'la' ? 'ທ່ານແນ່ໃຈບໍ່ທີ່ຈະລົບລາຍການໜີ້ນີ້?' : 'Delete this debt record?')) return;
    try {
      await deleteDoc(doc(db, 'debts', id));
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Export Excel
  const handleExportExcel = () => {
    const headers = ['Type', 'Party Name', 'Phone', 'Invoice No', 'Amount (LAK)', 'Status', 'Issue Date', 'Due Date', 'Category', 'Remark'];
    const rows = debts.map(d => [
      d.type === 'payable' ? 'ໜີ້ຕ້ອງສົ່ງ (AP)' : 'ໜີ້ຕ້ອງຮັບ (AR)',
      d.partyName,
      d.partyPhone || '-',
      d.invoiceNo || '-',
      d.amount || 0,
      d.status === 'settled' ? 'ຊຳລະແລ້ວ' : 'ຄ້າງຊຳລະ',
      d.issueDate,
      d.dueDate,
      d.category,
      d.remark || ''
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Debts Ledger');
    writeFile(workbook, `Debts_Ledger_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  return (
    <div className="space-y-6">

      {/* ================= 1. HEADER & TOP ACTIONS ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white dark:bg-[#073069] rounded-[2rem] border border-slate-200/70 dark:border-white/10 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <Receipt className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                {i18n.language === 'la' ? 'ບັນຊີໜີ້ຕ້ອງສົ່ງ & ໜີ້ຕ້ອງຮັບ (AP / AR Ledger)' : 'Accounts Payable & Receivable'}
              </h2>
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {(selectedBranch || 'branch_1') === 'branch_1' ? (i18n.language === 'la' ? 'ສາຂາ 1' : 'Branch 1') : (i18n.language === 'la' ? 'ສາຂາ 2' : 'Branch 2')}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {i18n.language === 'la' ? 'ຄຸ້ມຄອງໜີ້ສິນ • ແນບໃບ Invoice • ດຶງເຂົ້າລາຍຮັບ-ລາຍຈ່າຍອັດຕະໂນມັດ' : 'Manage Creditor & Debtor Accounts with Invoice Attachment'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3.5 py-2 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold uppercase flex items-center gap-1.5 cursor-pointer hover:bg-slate-200"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
          
          <button
            type="button"
            onClick={() => {
              setEditingDebtId(null);
              setShowAddForm(true);
            }}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{i18n.language === 'la' ? 'ລົງບັນທຶກໜີ້ໃໝ່' : 'Log New Debt'}</span>
          </button>
        </div>
      </div>

      {/* ================= 2. SUMMARY BENTO CARDS ================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        
        {/* 🔴 ACCOUNTS PAYABLE (ໜີ້ຕ້ອງສົ່ງ / ເຈົ້າໜີ້) */}
        <div className="bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent p-6 rounded-[2rem] border border-rose-500/20 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-black uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'ໜີ້ຕ້ອງສົ່ງທັງໝົດ (Pending Expenses / AP)' : 'Accounts Payable (We Owe)'}</span>
            </span>
            <span className="px-2.5 py-0.5 bg-rose-500 text-white text-[9px] font-black uppercase rounded-full">
              {i18n.language === 'la' ? 'ຄ້າງຈ່າຍ' : 'Pending Pay'}
            </span>
          </div>

          <h3 className="text-3xl font-black font-mono text-rose-600 dark:text-rose-400">
            {Math.round(summary.totalPendingPayable).toLocaleString()} <span className="text-lg font-sans font-bold">₭</span>
          </h3>

          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {i18n.language === 'la' ? 'ເມື່ອກົດຊຳລະ ຍອດຈະຖືກດຶງເຂົ້າເປັນ "ລາຍຈ່າຍ" ໃນ Finance ທັນທີ' : 'Settling will push this as an Expense into Financials'}
          </p>
        </div>

        {/* 🟢 ACCOUNTS RECEIVABLE (ໜີ້ຕ້ອງຮັບ / ລູກໜີ້) */}
        <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-6 rounded-[2rem] border border-emerald-500/20 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'ໜີ້ຕ້ອງຮັບທັງໝົດ (Pending Incomes / AR)' : 'Accounts Receivable (Owed to Us)'}</span>
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-500 text-white text-[9px] font-black uppercase rounded-full">
              {i18n.language === 'la' ? 'ຄ້າງຮັບ' : 'Pending Receive'}
            </span>
          </div>

          <h3 className="text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(summary.totalPendingReceivable).toLocaleString()} <span className="text-lg font-sans font-bold">₭</span>
          </h3>

          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {i18n.language === 'la' ? 'ເມື່ອກົດຮັບເງິນ ຍອດຈະຖືກດຶງເຂົ້າເປັນ "ລາຍຮັບ" ໃນ Finance ທັນທີ' : 'Receiving will push this as Income into Financials'}
          </p>
        </div>

      </div>

      {/* ================= 3. FILTER TABS & SEARCH ================= */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
        <div className="flex bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200 dark:border-white/10 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
              activeTab === 'all' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500'
            }`}
          >
            {i18n.language === 'la' ? 'ທັງໝົດ' : 'All Debts'} ({debts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payable')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
              activeTab === 'payable' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500'
            }`}
          >
            {i18n.language === 'la' ? 'ໜີ້ຕ້ອງສົ່ງ (AP)' : 'Payable'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('receivable')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-black uppercase transition-all ${
              activeTab === 'receivable' ? 'bg-[#052659] text-white shadow-md' : 'text-slate-500'
            }`}
          >
            {i18n.language === 'la' ? 'ໜີ້ຕ້ອງຮັບ (AR)' : 'Receivable'}
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <input
            type="text"
            placeholder={i18n.language === 'la' ? 'ຄົ້ນຫາເຈົ້າໜີ້, ລູກໜີ້, ເລກບິນ...' : 'Search party, invoice #...'}
            className="w-full h-10 pl-9 pr-3 rounded-2xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
        </div>
      </div>

      {/* ================= 4. DEBT CARDS GRID ================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {debts
          .filter(d => {
            const matchesTab = activeTab === 'all' || d.type === activeTab;
            const matchesSearch = 
              (d.partyName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
              (d.invoiceNo || '').toLowerCase().includes(searchQuery.toLowerCase());
            return matchesTab && matchesSearch;
          })
          .map(debt => {
            const isPayable = debt.type === 'payable';
            const isSettled = debt.status === 'settled';
            const isOverdue = !isSettled && debt.dueDate && isPast(parseISO(debt.dueDate));

            return (
              <div 
                key={debt.id} 
                className={`bg-white dark:bg-[#073069] rounded-[2rem] p-5 border shadow-sm flex flex-col justify-between space-y-4 transition-all relative ${
                  isSettled 
                    ? 'border-emerald-500/30 opacity-80' 
                    : isOverdue 
                      ? 'border-red-500/40 ring-2 ring-red-500/10' 
                      : 'border-slate-200/80 dark:border-white/10'
                }`}
              >
                {/* Header */}
                <div className="flex justify-between items-start">
                  <div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      isPayable ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    }`}>
                      {isPayable ? '🔴 ໜີ້ຕ້ອງສົ່ງ (AP)' : '🟢 ໜີ້ຕ້ອງຮັບ (AR)'}
                    </span>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white mt-1.5 truncate max-w-[180px]">
                      {debt.partyName}
                    </h3>
                    {debt.partyPhone && (
                      <p className="text-[10px] text-slate-400 font-medium">📞 {debt.partyPhone}</p>
                    )}
                  </div>

                  {/* Status Badge */}
                  <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase ${
                    isSettled 
                      ? 'bg-emerald-500 text-white' 
                      : isOverdue 
                        ? 'bg-red-500 text-white animate-pulse' 
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  }`}>
                    {isSettled ? '✓ ສຳເລັດແລ້ວ' : isOverdue ? '⚠️ ກາຍກຳນົດ' : '⏳ ຄ້າງຊຳລະ'}
                  </span>
                </div>

                {/* Amount */}
                <div className="p-3.5 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-100 dark:border-white/5 flex justify-between items-center">
                  <div>
                    <span className="text-[9px] font-black uppercase text-slate-400 block">
                      {isPayable ? 'ຍອດທີ່ຕ້ອງຈ່າຍ' : 'ຍອດທີ່ຕ້ອງຮັບ'}
                    </span>
                    <p className="text-xl font-black font-mono text-slate-900 dark:text-white mt-0.5">
                      {Math.round(Number(debt.amount) || 0).toLocaleString()} ₭
                    </p>
                  </div>

                  {debt.invoiceBase64 && (
                    <button
                      type="button"
                      onClick={() => setPreviewImageUrl(debt.invoiceBase64)}
                      className="p-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl transition-all flex items-center gap-1 text-[9px] font-black uppercase"
                      title="View Invoice"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>Invoice</span>
                    </button>
                  )}
                </div>

                {/* Dates & Category */}
                <div className="space-y-1.5 text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-white/5 pt-3 font-medium">
                  <div className="flex justify-between">
                    <span>ວັນທີອອກບິນ:</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-white">{debt.issueDate || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ກຳນົດຊຳລະ (Due):</span>
                    <span className={`font-mono font-bold ${isOverdue ? 'text-red-500' : 'text-slate-800 dark:text-white'}`}>
                      {debt.dueDate || '-'}
                    </span>
                  </div>
                  {debt.invoiceNo && (
                    <div className="flex justify-between">
                      <span>ເລກບິນ Invoice:</span>
                      <span className="font-mono font-bold text-blue-500">{debt.invoiceNo}</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center gap-2">
                  {!isSettled ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSettlingDebt(debt);
                        setSettleDate(format(new Date(), 'yyyy-MM-dd'));
                      }}
                      className={`flex-1 py-2.5 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md cursor-pointer transition-all ${
                        isPayable ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                      <span>{isPayable ? 'ຊຳລະໜີ້ (Pay)' : 'ຮັບເງິນໜີ້ (Receive)'}</span>
                    </button>
                  ) : (
                    <div className="flex-1 py-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl text-[10px] font-black text-center uppercase">
                      ✓ Sync ເຂົ້າ Finance ແລ້ວ ({debt.settledChannel})
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDeleteDebt(debt.id)}
                    className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* ================= 5. MODAL: LOG NEW DEBT ================= */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border border-white/10 space-y-5 max-h-[90vh] overflow-y-auto">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-500" />
                <span>{editingDebtId ? 'ແກ້ໄຂໜີ້' : 'ບັນທຶກໜີ້ໃໝ່ (New Debt Record)'}</span>
              </h3>
              <button type="button" onClick={() => setShowAddForm(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleSaveDebt} className="space-y-4">
              
              {/* Type Switcher: Payable vs Receivable */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">ປະເພດໜີ້ (Debt Type)</label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-black/25 p-1 rounded-2xl border border-slate-200 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'payable', category: 'Purchasing' })}
                    className={`py-2 px-3 rounded-xl text-xs font-black transition-all ${
                      formData.type === 'payable' ? 'bg-rose-500 text-white shadow-md' : 'text-slate-500'
                    }`}
                  >
                    🔴 ໜີ້ຕ້ອງສົ່ງ (AP - We Owe)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'receivable', category: 'Sales' })}
                    className={`py-2 px-3 rounded-xl text-xs font-black transition-all ${
                      formData.type === 'receivable' ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-500'
                    }`}
                  >
                    🟢 ໜີ້ຕ້ອງຮັບ (AR - Owed to Us)
                  </button>
                </div>
              </div>

              {/* Party Name & Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">
                    {formData.type === 'payable' ? 'ຊື່ເຈົ້າໜີ້ / ຮ້ານຄ້າ' : 'ຊື່ລູກໜີ້ / ລູກຄ້າ'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ຮ້ານ Latda, ທ້າວ ສົມພອນ..."
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                    value={formData.partyName}
                    onChange={e => setFormData({ ...formData, partyName: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ເບີໂທລະສັບ (Phone)</label>
                  <input
                    type="text"
                    placeholder="020..."
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                    value={formData.partyPhone}
                    onChange={e => setFormData({ ...formData, partyPhone: e.target.value })}
                  />
                </div>
              </div>

              {/* Amount & Invoice No */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ຈຳນວນເງິນໜີ້ (Amount ₭)</label>
                  <input
                    type="text"
                    required
                    placeholder="0"
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-base font-mono font-black outline-none text-slate-800 dark:text-white"
                    value={displayAmount}
                    onChange={e => {
                      const clean = e.target.value.replace(/,/g, '');
                      if (clean === '' || !isNaN(Number(clean))) {
                        setDisplayAmount(formatWithCommas(clean));
                        setFormData({ ...formData, amount: Number(clean) || 0 });
                      }
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ເລກບິນ Invoice #</label>
                  <input
                    type="text"
                    placeholder="INV-001..."
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold outline-none text-slate-800 dark:text-white"
                    value={formData.invoiceNo}
                    onChange={e => setFormData({ ...formData, invoiceNo: e.target.value })}
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ວັນທີອອກບິນ (Issue Date)</label>
                  <input
                    type="date"
                    required
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.issueDate}
                    onChange={e => setFormData({ ...formData, issueDate: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ກຳນົດຊຳລະ (Due Date)</label>
                  <input
                    type="date"
                    required
                    className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                    value={formData.dueDate}
                    onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
                  />
                </div>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">ໝວດໝູ່ (Category)</label>
                <select
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                  value={formData.category}
                  onChange={e => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="Purchasing">🛒 Purchasing (ຊື້ວັດຖຸດິບ)</option>
                  <option value="Sales">📈 Sales (ຍອດຂາຍ)</option>
                  <option value="rental">🏠 Rental (ຄ່າເຊົ່າ)</option>
                  <option value="salary">👥 Salary (ເງິນເດືອນ)</option>
                  <option value="operations">⚙️ Operations (ດຳເນີນງານ)</option>
                  <option value="other">📦 Other (ອື່ນໆ)</option>
                </select>
              </div>

              {/* Invoice Image Attachment */}
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-black/20 rounded-2xl border border-dashed border-slate-300 dark:border-white/10">
                <div className="flex justify-between items-center">
                  <span className="text-[9.5px] font-black uppercase text-slate-500 flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-500" />
                    <span>ຮູບໃບບິນ Invoice (Base64)</span>
                  </span>
                  {formData.invoiceBase64 && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, invoiceBase64: '' })}
                      className="text-[9px] font-black text-red-500 hover:underline uppercase"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {formData.invoiceBase64 ? (
                  <div className="relative rounded-xl overflow-hidden max-h-32 border border-slate-200">
                    <img src={formData.invoiceBase64} alt="Invoice" className="w-full h-32 object-cover" />
                  </div>
                ) : (
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*"
                      onChange={handleImageFileChange}
                      className="hidden"
                      id="debt-invoice-input"
                    />
                    <label
                      htmlFor="debt-invoice-input"
                      className="w-full py-3 rounded-xl border border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center gap-2 text-xs font-bold text-slate-500 cursor-pointer hover:bg-slate-100"
                    >
                      <Upload className="w-4 h-4 text-emerald-500" />
                      <span>ອັບໂຫຼດຮູບໃບ Invoice ຫຼື ກັອບປີ້ວາງ (Ctrl+V)</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Memo */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">ໝາຍເຫດ (Memo)</label>
                <input
                  type="text"
                  placeholder="ໝາຍເຫດເພີ່ມເຕີມ..."
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-white"
                  value={formData.remark}
                  onChange={e => setFormData({ ...formData, remark: e.target.value })}
                />
              </div>

              <button
                type="submit"
                disabled={saveLoading}
                className="w-full h-12 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                {saveLoading ? 'Saving...' : 'Save Debt Record'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ================= 6. MODAL: SETTLE DEBT & PUSH TO FINANCE ================= */}
      {settlingDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border border-white/10 space-y-5">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>
                  {settlingDebt.type === 'payable' ? 'ຊຳລະໜີ້ & ດຶງເຂົ້າລາຍຈ່າຍ' : 'ຮັບເງິນໜີ້ & ດຶງເຂົ້າລາຍຮັບ'}
                </span>
              </h3>
              <button type="button" onClick={() => setSettlingDebt(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-black/20 rounded-2xl space-y-2 border border-slate-100 dark:border-white/5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">{settlingDebt.type === 'payable' ? 'ເຈົ້າໜີ້:' : 'ລູກໜີ້:'}</span>
                <span className="font-bold text-slate-900 dark:text-white">{settlingDebt.partyName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">ຍອດເງິນ:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                  {Math.round(Number(settlingDebt.amount) || 0).toLocaleString()} ₭
                </span>
              </div>
              {settlingDebt.invoiceNo && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Invoice:</span>
                  <span className="font-mono font-bold text-blue-500">{settlingDebt.invoiceNo}</span>
                </div>
              )}
            </div>

            {/* Payment Channel Selection */}
            <div className="space-y-1">
              <label className="text-[9.5px] font-black uppercase text-slate-400">
                {settlingDebt.type === 'payable' ? 'ຊຳລະຜ່ານຊ່ອງທາງໃດ?' : 'ຮັບເງິນຜ່ານຊ່ອງທາງໃດ?'}
              </label>
              <select
                className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                value={settleChannel}
                onChange={e => setSettleChannel(e.target.value as PaymentChannel)}
              >
                <option value="Onepay">📱 BCEL OnePay</option>
                <option value="Cash">💵 Cash (ເງິນສົດ)</option>
                <option value="LDB">🏦 ທະນາຄານ LDB</option>
              </select>
            </div>

            {/* Settle Date */}
            <div className="space-y-1">
              <label className="text-[9.5px] font-black uppercase text-slate-400">ວັນທີຊຳລະຕົວຈິງ (Payment Date)</label>
              <input
                type="date"
                className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-800 dark:text-white"
                value={settleDate}
                onChange={e => setSettleDate(e.target.value)}
              />
            </div>

            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 leading-normal">
              💡 ລະບົບຈະສ້າງລາຍການ <strong>{settlingDebt.type === 'payable' ? 'Expense' : 'Income'}</strong> ໃນ Finance ພ້ອມຕິດຮູບໃບ Invoice ໃຫ້ທັນທີ!
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSettlingDebt(null)}
                className="flex-1 py-3 bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-xl font-black text-xs uppercase"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={settlingLoading}
                onClick={handleExecuteSettlement}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20"
              >
                {settlingLoading ? 'Processing...' : 'Confirm Settlement'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ================= 7. FULL IMAGE VIEWER MODAL ================= */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-2xl rounded-[2.5rem] p-6 shadow-2xl border border-white/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h4 className="text-xs font-black uppercase text-slate-900 dark:text-white flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-blue-500" />
                <span>Invoice View</span>
              </h4>
              <button type="button" onClick={() => setPreviewImageUrl(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-2xl bg-black/5 flex items-center justify-center p-2">
              <img src={previewImageUrl} alt="Invoice Full" className="max-h-[70vh] w-auto object-contain rounded-xl" />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
