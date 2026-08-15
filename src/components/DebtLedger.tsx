import React, { useState, useEffect, useMemo, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  deleteDoc, doc, updateDoc, serverTimestamp 
} from 'firebase/firestore';
import { 
  Plus, Trash2, X, Search, Download, 
  Receipt, Image as ImageIcon, Upload, Eye, Wallet, CreditCard,
  Building2, ArrowUpRight, ArrowDownRight, CheckCircle2,
  Check, Archive, FileText, UserPlus, ChevronDown
} from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { useTranslation } from 'react-i18next';

export type DebtType = 'payable' | 'receivable'; 
export type PaymentChannel = 'Cash' | 'Onepay' | 'LDB';

const PRESET_CREDITORS = ['CHANHOM', 'LATDA', 'HEAVENLY', 'DMART', 'MARRY ANN'];

export default function DebtLedger({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [debts, setDebts] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'payable' | 'receivable'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Settlement Modal State
  const [settlingDebt, setSettlingDebt] = useState<any | null>(null);
  const [settleChannel, setSettleChannel] = useState<PaymentChannel>('Onepay');
  const [settleDate, setSettleDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [settlingLoading, setSettlingLoading] = useState(false);

  // Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  // 🌟 Dropdown Creditor State ('OTHER' means custom input)
  const [selectedCreditorPreset, setSelectedCreditorPreset] = useState<string>('CHANHOM');
  const [customPartyName, setCustomPartyName] = useState<string>('');

  const [formData, setFormData] = useState({
    type: 'payable' as DebtType,
    partyName: 'CHANHOM',
    partyPhone: '',
    invoiceNo: '',
    amount: 0,
    category: 'Purchasing',
    issueDate: format(new Date(), 'yyyy-MM-dd'),
    dueDate: format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    remark: '',
    invoiceBase64: ''
  });

  const [displayAmount, setDisplayAmount] = useState('');

  const formatWithCommas = (val: string | number) => {
    const clean = String(val).replace(/,/g, '');
    if (!clean || isNaN(Number(clean))) return '';
    return Number(clean).toLocaleString();
  };

  // Clipboard paste support
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

  // Listen to Firestore Debts & Supplier Prices
  useEffect(() => {
    const branch = selectedBranch || 'branch_1';

    const unsubDebts = onSnapshot(query(collection(db, 'debts'), orderBy('dueDate', 'asc')), (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDebts(all.filter((d: any) => (d.branchId || 'branch_1') === branch));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'debts');
      setLoading(false);
    });

    const unsubSuppliers = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return () => {
      unsubDebts();
      unsubSuppliers();
    };
  }, [selectedBranch]);

  // Combined Unique Creditors List for Dropdown
  const creditorOptions = useMemo(() => {
    const set = new Set<string>(PRESET_CREDITORS);
    supplierPrices.forEach(p => {
      if (p.supplier && p.supplier.trim() && p.supplier.toUpperCase() !== 'OTHER') {
        set.add(p.supplier.trim().toUpperCase());
      }
    });
    debts.forEach(d => {
      if (d.type === 'payable' && d.partyName && d.partyName.trim()) {
        set.add(d.partyName.trim());
      }
    });
    return Array.from(set);
  }, [supplierPrices, debts]);

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

  const summary = useMemo(() => {
    let totalPendingPayable = 0;
    let totalPendingReceivable = 0;

    debts.forEach(d => {
      const amt = Number(d.amount) || 0;
      if (d.status === 'pending') {
        if (d.type === 'payable') totalPendingPayable += amt;
        else totalPendingReceivable += amt;
      }
    });

    return {
      totalPendingPayable,
      totalPendingReceivable
    };
  }, [debts]);

  const handleSaveDebt = async (e: React.FormEvent) => {
    e.preventDefault();

    // Determine final party name
    let finalPartyName = formData.partyName;
    if (formData.type === 'payable') {
      if (selectedCreditorPreset === 'OTHER') {
        finalPartyName = customPartyName.trim();
      } else {
        finalPartyName = selectedCreditorPreset;
      }
    }

    if (!finalPartyName || formData.amount <= 0) {
      alert(i18n.language === 'la' ? 'ກະລຸນາໃສ່ຊື່ເຈົ້າໜີ້/ລູກໜີ້ ແລະ ຈຳນວນເງິນໃຫ້ຖືກຕ້ອງ' : 'Please provide party name and amount');
      return;
    }

    try {
      setSaveLoading(true);
      const branchId = selectedBranch || 'branch_1';

      const debtData = {
        ...formData,
        partyName: finalPartyName,
        branchId,
        status: 'pending',
        updatedAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com'
      };

      if (editingDebtId) {
        await updateDoc(doc(db, 'debts', editingDebtId), debtData);
      } else {
        await addDoc(collection(db, 'debts'), {
          ...debtData,
          createdAt: serverTimestamp()
        });
      }

      setShowAddForm(false);
      setEditingDebtId(null);
      setCustomPartyName('');
      setSelectedCreditorPreset('CHANHOM');
      setFormData({
        type: 'payable',
        partyName: 'CHANHOM',
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
      alert(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  };

  // Settle with Finance Sync
  const handleExecuteSettlementWithFinance = async () => {
    if (!settlingDebt) return;
    try {
      setSettlingLoading(true);
      const branchId = selectedBranch || 'branch_1';
      const timeNow = format(new Date(), 'HH:mm');

      const isPayable = settlingDebt.type === 'payable';
      const txType = isPayable ? 'expense' : 'income';
      const defaultCategory = isPayable ? (settlingDebt.category || 'Purchasing') : 'Sales';
      
      const description = isPayable 
        ? `ຊຳລະໜີ້ໃຫ້: ${settlingDebt.partyName} ${settlingDebt.invoiceNo ? `(#${settlingDebt.invoiceNo})` : ''}`
        : `ຮັບຊຳລະໜີ້ຈາກ: ${settlingDebt.partyName} ${settlingDebt.invoiceNo ? `(#${settlingDebt.invoiceNo})` : ''}`;

      const txRef = await addDoc(collection(db, 'transactions'), {
        type: txType,
        amount: Number(settlingDebt.amount) || 0,
        category: defaultCategory,
        description,
        source: settleChannel,
        receiptUrl: settlingDebt.invoiceBase64 || '',
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

      await updateDoc(doc(db, 'debts', settlingDebt.id), {
        status: 'settled',
        settledMode: 'finance_synced',
        settledDate: settleDate,
        settledChannel: settleChannel,
        settledTxId: txRef.id,
        updatedAt: serverTimestamp()
      });

      alert(i18n.language === 'la' ? 'ຊຳລະໜີ້ ແລະ ດຶງເຂົ້າ Finance ສຳເລັດ!' : 'Settled and synced to Finance!');
      setSettlingDebt(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSettlingLoading(false);
    }
  };

  // Settle Archive Only (No Finance Sync)
  const handleArchiveWithoutFinance = async () => {
    if (!settlingDebt) return;
    try {
      setSettlingLoading(true);

      await updateDoc(doc(db, 'debts', settlingDebt.id), {
        status: 'settled',
        settledMode: 'archive_only',
        settledDate: settleDate,
        settledChannel: 'Internal / Reminder',
        updatedAt: serverTimestamp()
      });

      alert(i18n.language === 'la' ? 'ປິດໜີ້ / Archive ສຳເລັດແລ້ວ! (ບໍ່ໄດ້ກະທົບຍອດ Finance)' : 'Archived as Reminder Only (Finance untouched)!');
      setSettlingDebt(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSettlingLoading(false);
    }
  };

  const handleDeleteDebt = async (id: string) => {
    if (!confirm(i18n.language === 'la' ? 'ທ່ານແນ່ໃຈບໍ່ທີ່ຈະລົບໜີ້ນີ້?' : 'Delete this debt record?')) return;
    try {
      await deleteDoc(doc(db, 'debts', id));
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

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

      {/* Top Header */}
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
              {i18n.language === 'la' ? 'ຄຸ້ມຄອງໜີ້ສິນ • Reminder Invoices • ດຶງເຂົ້າ Finance ຫຼື Archive ໄດ້' : 'Manage Creditor & Debtor Accounts'}
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
              setSelectedCreditorPreset('CHANHOM');
              setCustomPartyName('');
              setShowAddForm(true);
            }}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{i18n.language === 'la' ? 'ລົງບັນທຶກໜີ້ໃໝ່' : 'Log New Debt'}</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent p-6 rounded-[2rem] border border-rose-500/20 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-black uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'ໜີ້ຕ້ອງສົ່ງທັງໝົດ (Pending Expenses / AP)' : 'Accounts Payable'}</span>
            </span>
            <span className="px-2.5 py-0.5 bg-rose-500 text-white text-[9px] font-black uppercase rounded-full">
              {i18n.language === 'la' ? 'ຄ້າງຈ່າຍ' : 'Pending Pay'}
            </span>
          </div>

          <h3 className="text-3xl font-black font-mono text-rose-600 dark:text-rose-400">
            {Math.round(summary.totalPendingPayable).toLocaleString()} <span className="text-lg font-sans font-bold">₭</span>
          </h3>
        </div>

        <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-6 rounded-[2rem] border border-emerald-500/20 shadow-sm space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-black uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" />
              <span>{i18n.language === 'la' ? 'ໜີ້ຕ້ອງຮັບທັງໝົດ (Pending Incomes / AR)' : 'Accounts Receivable'}</span>
            </span>
            <span className="px-2.5 py-0.5 bg-emerald-500 text-white text-[9px] font-black uppercase rounded-full">
              {i18n.language === 'la' ? 'ຄ້າງຮັບ' : 'Pending Receive'}
            </span>
          </div>

          <h3 className="text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {Math.round(summary.totalPendingReceivable).toLocaleString()} <span className="text-lg font-sans font-bold">₭</span>
          </h3>
        </div>
      </div>

      {/* Filter Tabs */}
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

      {/* Debt Cards Grid */}
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

                  <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase ${
                    isSettled 
                      ? 'bg-emerald-500 text-white' 
                      : isOverdue 
                        ? 'bg-red-500 text-white animate-pulse' 
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  }`}>
                    {isSettled ? (debt.settledMode === 'archive_only' ? '📁 Archived' : '✓ ສຳເລັດ') : isOverdue ? '⚠️ ກາຍກຳນົດ' : '⏳ ຄ້າງຊຳລະ'}
                  </span>
                </div>

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
                      className="p-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl transition-all flex items-center gap-1 text-[9px] font-black uppercase cursor-pointer"
                      title="View Invoice"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>Invoice</span>
                    </button>
                  )}
                </div>

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
                    <div className="flex-1 py-2 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-black text-center uppercase">
                      {debt.settledMode === 'archive_only' ? '📁 ປິດໜີ້ເທົ່ານັ້ນ (Reminder)' : `✓ Sync Finance (${debt.settledChannel})`}
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

      {/* 🌟 MODAL: LOG NEW DEBT (WITH DROPDOWN + OTHER CUSTOM INPUT) */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-lg rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border border-white/10 space-y-5 max-h-[90vh] overflow-y-auto">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-500" />
                <span>{editingDebtId ? 'ແກ້ໄຂໜີ້' : 'ບັນທຶກໜີ້ໃໝ່ (New Debt / IOU)'}</span>
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
                    🟢 ໜີ້ຕ້ອງຮັບ / ຢືມເງິນ (AR)
                  </button>
                </div>
              </div>

              {/* 🌟 PARTY NAME: DROPDOWN FOR CREDITOR + 'OTHER' OPTION */}
              {formData.type === 'payable' ? (
                <div className="space-y-2 p-3.5 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-200/60 dark:border-white/5">
                  <div className="space-y-1">
                    <label className="text-[9.5px] font-black uppercase text-slate-400">
                      {i18n.language === 'la' ? 'ເລືອກເຈົ້າໜີ້ / ຜູ້ສະໜອງ' : 'Select Creditor / Supplier'}
                    </label>
                    <select
                      className="w-full h-11 px-3 rounded-xl bg-white dark:bg-[#073069] border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white cursor-pointer"
                      value={selectedCreditorPreset}
                      onChange={e => setSelectedCreditorPreset(e.target.value)}
                    >
                      {creditorOptions.map(sup => (
                        <option key={sup} value={sup}>{sup}</option>
                      ))}
                      <option value="OTHER">➕ ອື່ນໆ (Other - ລະບຸຊື່ໃໝ່ເອງ)</option>
                    </select>
                  </div>

                  {/* 🌟 SHOW CUSTOM TEXT INPUT IF 'OTHER' IS SELECTED */}
                  {selectedCreditorPreset === 'OTHER' && (
                    <div className="space-y-1 animate-in fade-in duration-200 pt-1">
                      <label className="text-[9.5px] font-black uppercase text-amber-500">
                        {i18n.language === 'la' ? 'ລະບຸຊື່ເຈົ້າໜີ້ (Custom Creditor Name)' : 'Specify Creditor Name'}
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. ບໍລິສັດ ກ, ຮ້ານ ຂ..."
                        className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#073069] border border-amber-400 text-xs font-bold text-slate-800 dark:text-white outline-none"
                        value={customPartyName}
                        onChange={e => setCustomPartyName(e.target.value)}
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              ) : (
                /* RECEIVABLE / DEBTOR INPUT */
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">
                    {i18n.language === 'la' ? 'ຊື່ລູກໜີ້ / ຜູ້ຢືມເງິນ' : 'Debtor / Borrower Name'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ທ້າວ ສົມພອນ, ລູກຄ້າ VIP..."
                    className="w-full h-11 px-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-bold outline-none text-slate-800 dark:text-white"
                    value={formData.partyName}
                    onChange={e => setFormData({ ...formData, partyName: e.target.value })}
                  />
                </div>
              )}

              {/* Phone & Invoice No */}
              <div className="grid grid-cols-2 gap-3">
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

              {/* Amount */}
              <div className="space-y-1">
                <label className="text-[9.5px] font-black uppercase text-slate-400">ຈຳນວນເງິນ (Amount ₭)</label>
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

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9.5px] font-black uppercase text-slate-400">ວັນທີອອກບິນ</label>
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

              {/* Invoice Image */}
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
                      className="text-[9px] font-black text-red-500 uppercase"
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
                      <span>ອັບໂຫຼດຮູບ ຫຼື ກັອບປີ້ວາງ (Ctrl+V)</span>
                    </label>
                  </div>
                )}
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

      {/* Modal: Settlement Actions */}
      {settlingDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-md rounded-[2.5rem] p-6 sm:p-8 shadow-2xl border border-white/10 space-y-5">
            
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>
                  {settlingDebt.type === 'payable' ? 'ປິດໜີ້ຕ້ອງສົ່ງ (Payable)' : 'ປິດໜີ້ຕ້ອງຮັບ / ຢືມເງິນ (Receivable)'}
                </span>
              </h3>
              <button type="button" onClick={() => setSettlingDebt(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-black/20 rounded-2xl space-y-2 border border-slate-100 dark:border-white/5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">{settlingDebt.type === 'payable' ? 'ເຈົ້າໜີ້:' : 'ລູກໜີ້/ຜູ້ຢືມ:'}</span>
                <span className="font-bold text-slate-900 dark:text-white">{settlingDebt.partyName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">ຍອດເງິນ:</span>
                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                  {Math.round(Number(settlingDebt.amount) || 0).toLocaleString()} ₭
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9.5px] font-black uppercase text-slate-400">ຊ່ອງທາງການເງິນ</label>
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

            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={settlingLoading}
                onClick={handleExecuteSettlementWithFinance}
                className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>1. ຊຳລະ & Sync ເຂົ້າ Finance ({settlingDebt.type === 'payable' ? 'ລາຍຈ່າຍ' : 'ລາຍຮັບ'})</span>
              </button>

              <button
                type="button"
                disabled={settlingLoading}
                onClick={handleArchiveWithoutFinance}
                className="w-full py-3 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-slate-300 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
              >
                <Archive className="w-4 h-4 text-amber-500" />
                <span>2. Archive / ປິດໜີ້ເທົ່ານັ້ນ (ບໍ່ດຶງເຂົ້າ Finance)</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Image Viewer */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#073069] w-full max-w-2xl rounded-[2.5rem] p-6 shadow-2xl border border-white/10 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/10 pb-3">
              <h4 className="text-xs font-black uppercase text-slate-900 dark:text-white flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-blue-500" />
                <span>Invoice Full View</span>
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
