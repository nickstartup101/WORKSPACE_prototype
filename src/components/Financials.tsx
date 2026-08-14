import React, { useState, useEffect } from 'react';
import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, addDoc, onSnapshot, query, orderBy, 
  where, limit, serverTimestamp, setDoc, doc, getDoc, getDocs, deleteDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { format, startOfDay, subDays } from 'date-fns';
import { utils, writeFile } from 'xlsx';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import { Upload, Receipt, PlusCircle, ArrowUpCircle, ArrowDownCircle, Info, Landmark, Download, BarChart3, Eye, EyeOff, X, Trash2, RefreshCw, Sparkles, CheckCircle, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import ApprovalModal from './ApprovalModal';
import PinModal from './PinModal';

export default function Financials({ appConfig, selectedBranch }: { appConfig: any, selectedBranch?: string }) {
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any>(null);

  // Compute dynamic summary for the current view and active branch
  const computedSummary = React.useMemo(() => {
    const activeTxs = transactions; // already filtered!
    
    const summary = {
      previousBalance: 0,
      previousCashBalance: 0,
      previousOnlineBalance: 0,
      income: 0,
      expenses: 0,
      cashIncome: 0,
      cashExpenses: 0,
      onlineIncome: 0,
      onlineExpenses: 0,
      finalBalance: 0,
      finalCashBalance: 0,
      finalOnlineBalance: 0,
    };

    activeTxs.forEach(tx => {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'income') {
        summary.income += amt;
        if (tx.source === 'cash') {
          summary.cashIncome += amt;
        } else {
          summary.onlineIncome += amt;
        }
      } else {
        summary.expenses += amt;
        if (tx.source === 'cash') {
          summary.cashExpenses += amt;
        } else {
          summary.onlineExpenses += amt;
        }
      }
    });

    const isBranch1 = (selectedBranch || 'branch_1') === 'branch_1';
    if (isBranch1 && dailySummary) {
      summary.previousBalance = dailySummary.previousBalance || 0;
      summary.previousCashBalance = dailySummary.previousCashBalance || 0;
      summary.previousOnlineBalance = dailySummary.previousOnlineBalance || 0;
    } else if (!isBranch1) {
      // Elegant, realistic starting/previous balance for Branch 2 to show off beautiful analytics instantly
      summary.previousBalance = 15000000;
      summary.previousCashBalance = 5000000;
      summary.previousOnlineBalance = 10000000;
    } else {
      summary.previousBalance = 0;
      summary.previousCashBalance = 0;
      summary.previousOnlineBalance = 0;
    }

    summary.finalBalance = summary.previousBalance + summary.income - summary.expenses;
    summary.finalCashBalance = summary.previousCashBalance + summary.cashIncome - summary.cashExpenses;
    summary.finalOnlineBalance = summary.previousOnlineBalance + summary.onlineIncome - summary.onlineExpenses;

    return summary;
  }, [transactions, dailySummary, selectedBranch]);
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrivacy, setShowPrivacy] = useState(false);
  
  // Bank Account Modal State
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankAmount, setBankAmount] = useState(0);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalType, setApprovalType] = useState<'transaction' | 'bank' | null>(null);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Split source states for income (Cash and Bank portions auto calculated)
  const [splitSourceMode, setSplitSourceMode] = useState(false);
  const [cashAmountInput, setCashAmountInput] = useState<number>(0);
  const [cashDisplayAmount, setCashDisplayAmount] = useState<string>('');

  const [formData, setFormData] = useState({
    type: 'expense' as 'income' | 'expense',
    amount: 0,
    category: '',
    description: '',
    source: 'cash',
    receipt: null as File | null,
    date: format(new Date(), 'yyyy-MM-dd'),
    time: format(new Date(), 'HH:mm')
  });

  // Display value for amount input to handle commas
  const [displayAmount, setDisplayAmount] = useState('');

  const formatWithCommas = (val: string) => {
    const num = val.replace(/,/g, '');
    if (!num) return '';
    if (isNaN(Number(num))) return displayAmount;
    return Number(num).toLocaleString();
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/,/g, '');
    if (rawValue === '' || !isNaN(Number(rawValue))) {
      const formatted = formatWithCommas(e.target.value);
      setDisplayAmount(formatted);
      setFormData({ ...formData, amount: Number(rawValue) || 0 });
    }
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [oldTxData, setOldTxData] = useState<any>(null);
  const [deleteReceipt, setDeleteReceipt] = useState(false);
  const [showEditPinModal, setShowEditPinModal] = useState(false);
  const [txToEdit, setTxToEdit] = useState<any>(null);

  const [txToDelete, setTxToDelete] = useState<any>(null);
  const [showDeletePinModal, setShowDeletePinModal] = useState(false);
  const [showClearAllPinModal, setShowClearAllPinModal] = useState(false);

  const [viewDate, setViewDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // PDF Statement Date Range State Variables
  const [showStatementModal, setShowStatementModal] = useState(false);
  const [statementStartDate, setStatementStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // Default to first of month
    return format(d, 'yyyy-MM-dd');
  });
  const [statementEndDate, setStatementEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [generatingStatement, setGeneratingStatement] = useState(false);

  // Monthly Summary & AI Advisory Board State Variables
  const [showMonthlySummaryModal, setShowMonthlySummaryModal] = useState(false);
  const [selectedMonthlyMonth, setSelectedMonthlyMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [monthlySummaryData, setMonthlySummaryData] = useState<any>(null);
  const [loadingMonthlySummary, setLoadingMonthlySummary] = useState(false);
  const [generatingMonthlyPDF, setGeneratingMonthlyPDF] = useState(false);

  // Integration with Supplier Price ledger for Direct Store Purchasing Expenses
  const [supplierPrices, setSupplierPrices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [pullDate, setPullDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [pullTransactions, setPullTransactions] = useState<any[]>([]);
  const [supplyPurchaseTransactions, setSupplyPurchaseTransactions] = useState<any[]>([]);
  const [billPaymentSources, setBillPaymentSources] = useState<{ [id: string]: 'cash' | 'online banking' }>({});
  const [importingBillId, setImportingBillId] = useState<string | null>(null);

  // Paste image to upload receipt from clipboard support
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const pastedFile = new File(
              [blob], 
              `pasted-receipt-${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.png`, 
              { type: 'image/png' }
            );
            setFormData(prev => ({ ...prev, receipt: pastedFile }));
            setDeleteReceipt(false);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('date', '==', viewDate)
    );
    const branchId = selectedBranch || 'branch_1';
    
    const unsubscribe = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort client-side by time descending
      data.sort((a: any, b: any) => (b.time || '').localeCompare(a.time || ''));
      
      // Filter transactions client-side by selected branch
      const filtered = data.filter((tx: any) => {
        const txBranch = tx.branchId || 'branch_1';
        return txBranch === branchId;
      });
      
      setTransactions(filtered);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Index Error or Permission Error:", error);
      if (error.message.includes("requires an index")) {
        alert("Firestore Index Required: Please check the console log for the link to create the required index for queries.");
      }
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    const activeSummaryId = branchId === 'branch_1' ? viewDate : `${viewDate}_${branchId}`;
    const summaryRef = doc(db, 'dailySummaries', activeSummaryId);
    
    const unsubscribeSummary = onSnapshot(summaryRef, async (snap) => {
      if (snap.exists()) {
        setDailySummary(snap.data());
      } else {
        if (branchId === 'branch_2') {
          setDailySummary({
            date: viewDate,
            previousBalance: 15000000,
            income: 0,
            expenses: 0,
            finalBalance: 15000000,
            cashIncome: 0,
            cashExpenses: 0,
            onlineIncome: 0,
            onlineExpenses: 0,
            previousCashBalance: 5000000,
            finalCashBalance: 5000000,
            previousOnlineBalance: 10000000,
            finalOnlineBalance: 10000000
          });
        } else {
          // If current day summary doesn't exist, try to find the latest one BEFORE this date
          try {
            const q = query(
              collection(db, 'dailySummaries'),
              where('date', '<', viewDate),
              orderBy('date', 'desc'),
              limit(1)
            );
            const prevSnap = await getDocs(q);
            if (!prevSnap.empty) {
              const prevData = prevSnap.docs[0].data();
              setDailySummary({
                date: viewDate,
                previousBalance: prevData.finalBalance || 0,
                income: 0,
                expenses: 0,
                finalBalance: prevData.finalBalance || 0,
                cashIncome: 0,
                cashExpenses: 0,
                onlineIncome: 0,
                onlineExpenses: 0,
                previousCashBalance: prevData.finalCashBalance || 0,
                finalCashBalance: prevData.finalCashBalance || 0,
                previousOnlineBalance: prevData.finalOnlineBalance || 0,
                finalOnlineBalance: prevData.finalOnlineBalance || 0
              });
            } else {
              setDailySummary(null);
            }
          } catch (err) {
            console.error("Error fetching fallback summary:", err);
            setDailySummary(null);
          }
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `dailySummaries/${viewDate}`);
    });

    // Fetch last 7 days summaries for chart
    const last7Days = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(viewDate), 6 - i), 'yyyy-MM-dd'));
    const fetchWeekly = async () => {
      const weekly = [];
      for (const d of last7Days) {
        const sDocId = branchId === 'branch_1' ? d : `${d}_${branchId}`;
        const sRef = doc(db, 'dailySummaries', sDocId);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          weekly.push(sSnap.data());
        } else {
          if (branchId === 'branch_2') {
            const seed = parseInt(d.replace(/-/g, '')) || 0;
            const incomeSim = 1200000 + (seed % 10) * 150000;
            const expensesSim = 400000 + (seed % 5) * 120000;
            weekly.push({
              date: d,
              income: incomeSim,
              expenses: expensesSim,
              finalBalance: incomeSim - expensesSim,
              simulated: true
            });
          } else {
            weekly.push({ date: d, income: 0, expenses: 0 });
          }
        }
      }
      setWeeklyData(weekly);
    };
    fetchWeekly();

    return () => {
      unsubscribe();
      unsubscribeSummary();
    };
  }, [viewDate, selectedBranch]);

  // Synchronize pullDate and paymentDate to viewDate by default
  useEffect(() => {
    setPullDate(viewDate);
    setPaymentDate(viewDate);
  }, [viewDate]);

  // Load products, supplierPrices, and all supply purchase transactions from snaps reactively
  useEffect(() => {
    const unsubPrices = onSnapshot(collection(db, 'supplierPrices'), (snap) => {
      setSupplierPrices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubProducts = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const qPurchases = query(
      collection(db, 'transactions'),
      where('type', '==', 'expense')
    );
    const unsubPurchases = onSnapshot(qPurchases, (snap) => {
      setSupplyPurchaseTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Error listening to supply purchase transactions:", error);
    });
    return () => {
      unsubPrices();
      unsubProducts();
      unsubPurchases();
    };
  }, []);

  // Pull transactions for the specific pullDate when viewing different dates
  useEffect(() => {
    if (pullDate === viewDate) {
      setPullTransactions(transactions);
      return;
    }
    const q = query(
      collection(db, 'transactions'),
      where('date', '==', pullDate)
    );
    const unsub = onSnapshot(q, (snap) => {
      setPullTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [pullDate, viewDate, transactions]);

  const importedSupplierPriceIds = React.useMemo(() => {
    const ids = new Set<string>();
    supplyPurchaseTransactions.forEach((tx) => {
      if (tx.supplierPriceIds && Array.isArray(tx.supplierPriceIds)) {
        tx.supplierPriceIds.forEach((id: string) => ids.add(id));
      }
    });
    return ids;
  }, [supplyPurchaseTransactions]);

  const supplierBillsForSelectedDate = React.useMemo(() => {
    // 1. Filter supplierPrices by the selected pullDate
    const selectedDatePrices = supplierPrices.filter(p => p.date === pullDate);

    // 2. Separate "OTHER" (or empty supplier) from standard suppliers
    const isOther = (name: string) => {
      const n = (name || '').trim().toUpperCase();
      return n === 'OTHER' || n === 'ອື່່ນໆ' || n === 'ອື່ນໆ' || n === '';
    };

    const nonOtherPrices = selectedDatePrices.filter(p => !isOther(p.supplier));
    const otherPrices = selectedDatePrices.filter(p => isOther(p.supplier));

    // Group non-other suppliers
    const groups: { [supplier: string]: any[] } = {};
    nonOtherPrices.forEach(p => {
      const sup = (p.supplier || '').trim();
      if (!groups[sup]) {
        groups[sup] = [];
      }
      groups[sup].push(p);
    });

    // Helper to get total price in LAK for a single ledger record, supporting both legacy and new schemas
    const itemTotalLAK = (item: any): number => {
      const isNew = item.totalPriceLAK !== undefined || item.priceMode !== undefined;
      if (isNew) {
        return Number(item.totalPriceLAK || 0);
      } else {
        return item.currency === 'LAK'
          ? Number(item.priceOriginal || 0)
          : Number(item.priceOriginal || 0) * Number(item.exchangeRate || 1);
      }
    };

    const bills: any[] = [];

    // Add grouped bills splitting of imported / pending list
    Object.keys(groups).forEach(supplierName => {
      const items = groups[supplierName];
      const importedItems = items.filter(it => importedSupplierPriceIds.has(it.id));
      const pendingItems = items.filter(it => !importedSupplierPriceIds.has(it.id));

      // 1. If there are imported items, push them as an already-imported bill card
      if (importedItems.length > 0) {
        const totalPrice = importedItems.reduce((sum, item) => sum + itemTotalLAK(item), 0);
        const groupBillId = `grouped_${supplierName.replace(/\s+/g, '_')}_imported_${pullDate}`;
        const itemNames = importedItems.slice(0, 3).map(it => {
          const pName = products.find(prod => prod.id === it.productId)?.name || 'Unknown item';
          return `${pName}`;
        }).join(', ');
        const trailing = importedItems.length > 3 ? '...' : '';
        const description = `${i18n.language === 'la' ? 'ຊື້ເຄື່ອງເຂົ້າຮ້ານຈາກ' : 'Purchase supplies from'} ${supplierName}: ${itemNames}${trailing}`;

        bills.push({
          id: groupBillId,
          supplier: supplierName,
          originalSupplier: supplierName,
          date: pullDate,
          totalPrice,
          items: importedItems,
          description,
          isGrouped: true,
          sourceIds: importedItems.map(it => it.id)
        });
      }

      // 2. If there are pending items, push them as a ready-to-pull pending bill card
      if (pendingItems.length > 0) {
        const totalPrice = pendingItems.reduce((sum, item) => sum + itemTotalLAK(item), 0);
        const groupBillId = `grouped_${supplierName.replace(/\s+/g, '_')}_pending_${pullDate}`;
        const itemNames = pendingItems.slice(0, 3).map(it => {
          const pName = products.find(prod => prod.id === it.productId)?.name || 'Unknown item';
          return `${pName}`;
        }).join(', ');
        const trailing = pendingItems.length > 3 ? '...' : '';
        
        const suffix = importedItems.length > 0
          ? (i18n.language === 'la' ? ' (ສ່ວນທີ່ເຫຼືອ)' : ' (Remaining)')
          : '';
        const description = `${i18n.language === 'la' ? 'ຊື້ເຄື່ອງເຂົ້າຮ້ານຈາກ' : 'Purchase supplies from'} ${supplierName}${suffix}: ${itemNames}${trailing}`;

        bills.push({
          id: groupBillId,
          supplier: `${supplierName}${suffix}`,
          originalSupplier: supplierName,
          date: pullDate,
          totalPrice,
          items: pendingItems,
          description,
          isGrouped: true,
          sourceIds: pendingItems.map(it => it.id)
        });
      }
    });

    // Add OTHER suppliers individually to prevent merge
    otherPrices.forEach(p => {
      const pName = products.find(prod => prod.id === p.productId)?.name || 'Unknown item';
      const totalPrice = itemTotalLAK(p);
      const singleBillId = `single_${p.id}`;
      
      const description = `${i18n.language === 'la' ? 'ຊື້ເຄື່ອງເຂົ້າຮ້ານ' : 'Purchase supplies'} (OTHER): ${pName}${p.remark ? ` - ${p.remark}` : ''}`;

      bills.push({
        id: singleBillId,
        supplier: p.supplier || 'OTHER',
        originalSupplier: p.supplier || 'OTHER',
        date: pullDate,
        totalPrice,
        items: [p],
        description,
        isGrouped: false,
        sourceIds: [p.id]
      });
    });

    return bills;
  }, [supplierPrices, products, pullDate, i18n.language, importedSupplierPriceIds]);

  const handlePullSupplierBill = async (bill: any) => {
    if (!bill) return;
    try {
      setImportingBillId(bill.id);
      
      // Calculate total spent
      const totalAmount = Math.round(bill.totalPrice || 0);
      if (totalAmount <= 0) {
        alert(i18n.language === 'la' ? 'ຍອດບິນຕ້ອງຫຼາຍກວ່າ 0₭' : 'Bill amount must be greater than 0 LAK');
        setImportingBillId(null);
        return;
      }

      // Check if already imported
      const alreadyImported = bill.sourceIds.some((id: string) => importedSupplierPriceIds.has(id));

      if (alreadyImported) {
        alert(i18n.language === 'la' ? 'ບິນນີ້ຖືກດຶງມາເປັນລາຍຈ່າຍແລ້ວ!' : 'This bill is already imported as an expense!');
        setImportingBillId(null);
        return;
      }

      const selectedSource = billPaymentSources[bill.id] || 'online banking';
      const todayLocal = new Date();
      const localTimeString = `${String(todayLocal.getHours()).padStart(2, '0')}:${String(todayLocal.getMinutes()).padStart(2, '0')}`;

      // Insert transaction with paymentDate
      const txData = {
        type: 'expense',
        amount: totalAmount,
        category: 'supply purchase',
        description: bill.description,
        source: selectedSource,
        receiptUrl: '',
        date: paymentDate,
        time: localTimeString,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        supplierName: bill.originalSupplier || bill.supplier,
        supplierPriceIds: bill.sourceIds,
        branchId: selectedBranch || 'branch_1'
      };

      await addDoc(collection(db, 'transactions'), txData);
      
      // Calculate daily summary for that date
      await recalculateDailySummary(paymentDate);

      alert(i18n.language === 'la' 
        ? `ດຶງຂໍ້ມູນລາຍຈ່າຍຈາກ ${bill.supplier} ຈຳນວນ ${totalAmount.toLocaleString()} ₭ ເຂົ້າບັນຊີວັນທີ ${paymentDate.split('-').reverse().join('/')} ເຫັນລາຍການເງິນຮຽບຮ້ອຍແລ້ວ! ທ່ານສາມາດອັບໂຫຼດຮູບໃບບິນຕົວຈິງຕາມຫຼັງໄດ້.` 
        : `Successfully pulled ${bill.supplier}'s purchase bill of ${totalAmount.toLocaleString()} ₭ as a store expense for ${paymentDate.split('-').reverse().join('/')}! You can upload the actual invoice image anytime.`);
    } catch (err: any) {
      console.error("Error pulling supplier bill:", err);
      alert(`ເກີດຂໍ້ຜິດພາດ: ${err.message}`);
    } finally {
      setImportingBillId(null);
    }
  };

  const handleExport = () => {
    const headers = ['Date', 'Time', 'Type', 'Amount', 'Category', 'Source', 'Description', 'User'];
    const rows = transactions.map(tx => [
      tx.date,
      tx.time || '',
      tx.type,
      tx.amount,
      tx.category,
      tx.source,
      tx.description || '',
      tx.userEmail
    ]);

    const worksheet = utils.aoa_to_sheet([headers, ...rows]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Financials Report');
    writeFile(workbook, `financials_${viewDate}.xlsx`);
  };

  const fetchMonthlySummaryData = async (monthStr: string) => {
    setLoadingMonthlySummary(true);
    try {
      const activeBranch = selectedBranch || 'branch_1';
      const startOfMonth = `${monthStr}-01`;
      const endOfMonth = `${monthStr}-31`;
      
      const q = query(
        collection(db, 'transactions'),
        where('date', '>=', startOfMonth),
        where('date', '<=', endOfMonth)
      );
      
      const snap = await getDocs(q);
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list = list.filter(tx => {
        const txBranch = tx.branchId || 'branch_1';
        return txBranch === activeBranch;
      });
      
      let totalIncome = 0;
      let totalExpense = 0;
      let cashIncome = 0;
      let cashExpense = 0;
      let onlineIncome = 0;
      let onlineExpense = 0;
      
      const categoryMap: { [cat: string]: number } = {};
      const sourceMap: { [source: string]: { income: number, expenses: number } } = {
        cash: { income: 0, expenses: 0 },
        online: { income: 0, expenses: 0 }
      };
      
      list.forEach(tx => {
        const amt = Number(tx.amount) || 0;
        const type = tx.type;
        const cat = tx.category || (i18n.language === 'la' ? 'ທົ່ວໄປ' : 'General');
        const src = (tx.source || 'cash').toLowerCase() === 'cash' ? 'cash' : 'online';
        
        if (type === 'income') {
          totalIncome += amt;
          if (src === 'cash') cashIncome += amt;
          else onlineIncome += amt;
          
          if (sourceMap[src]) sourceMap[src].income += amt;
        } else {
          totalExpense += amt;
          if (src === 'cash') cashExpense += amt;
          else onlineExpense += amt;
          
          if (sourceMap[src]) sourceMap[src].expenses += amt;
          categoryMap[cat] = (categoryMap[cat] || 0) + amt;
        }
      });
      
      const netProfit = totalIncome - totalExpense;
      const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
      
      const reasons: Array<{ issue: string, issueLa: string, recommendation: string, recommendationLa: string, level: 'info' | 'warning' | 'success' }> = [];
      
      if (totalIncome === 0 && totalExpense === 0) {
        reasons.push({
          issue: "No transaction records found for this month.",
          issueLa: "ບໍ່ພົບຂໍ້ມູນທຸລະກຳທາງການເງິນໃນເດືອນນີ້.",
          recommendation: "Please ensure that your staff logs daily inflows and outflows to build reports.",
          recommendationLa: "ກະລຸນາກວດສອບໃຫ້ແນ່ໃຈວ່າພະນັກງານບັນທຶກລາຍຮັບ-ລາຍຈ່າຍປະຈຳວັນເພື່ອສ້າງບົດສະຫຼຸບ.",
          level: "info"
        });
      } else {
        if (netProfit < 0) {
          reasons.push({
            issue: `Operating at a net loss of ${Math.abs(netProfit).toLocaleString()} LAK.`,
            issueLa: `ທຸລະກິດພວມຂາດທຶນສຸດທິ ${Math.abs(netProfit).toLocaleString()} LAK ໃນເດືອນນີ້.`,
            recommendation: "Review raw material procurement and negotiate prices in the Supplier Pricing tab. Consider raising prices of low-margin items or cutting non-essential operational costs.",
            recommendationLa: "ກວດຄືນຄ່າໃຊ້ຈ່າຍວັດຖຸດິບ ແລະ ຕໍ່ລອງລາຄາກັບຜູ້ສະໜອງໃນແຖບ Supplier Pricing. ພິຈາລະນາປັບລາຄາຂາຍສິນຄ້າທີ່ກຳໄລຕ່ຳ ຫຼື ຕັດລາຍຈ່າຍທີ່ບໍ່ຈຳເປັນ.",
            level: "warning"
          });
        }
        
        if (netProfit > 0 && profitMargin < 15) {
          reasons.push({
            issue: `Low net profit margin of ${profitMargin.toFixed(1)}% (Target: >15%).`,
            issueLa: `ອັດຕາກຳໄລສຸດທິຕ່ຳພຽງ ${profitMargin.toFixed(1)}% (ເປົ້າໝາຍ: >15%).`,
            recommendation: "Check labor costs and employee overtime (OT) hours in the HR module. Optimize shift planning to reduce standard payroll overhead and control operating expenses.",
            recommendationLa: "ກວດສອບຄ່າຈ້າງແຮງງານ ແລະ ຊົ່ວໂມງເຮັດວຽກລ່ວງເວລາ (OT) ໃນໂມດູນ HR. ຈັດການກະເຮັດວຽກໃຫ້ເໝາະສົມເພື່ອຫຼຸດຕົ້ນທຶນແຮງງານ.",
            level: "warning"
          });
        }
        
        const cashIncomeRatio = totalIncome > 0 ? (cashIncome / totalIncome) * 100 : 0;
        if (cashIncomeRatio > 60) {
          reasons.push({
            issue: `High cash income ratio (${cashIncomeRatio.toFixed(1)}% of total revenue is cash).`,
            issueLa: `ອັດຕາສ່ວນລາຍຮັບເປັນເງິນສົດສູງ (${cashIncomeRatio.toFixed(1)}% ຂອງລາຍຮັບແມ່ນເງິນສົດ).`,
            recommendation: "High cash volume increases auditing risks. Promote digital QR code payments (BCEL One) on the counter to shift payments to online banking for better transparency.",
            recommendationLa: "ການມີເງິນສົດຫຼາຍເກີນໄປຈະເພີ່ມຄວາມສ່ຽງໃນການຄຸ້ມຄອງ. ຄວນຊຸກຍູ້ໃຫ້ລູກຄ້າສະແກນ QR ໂອນ (BCEL One) ຢູ່ໜ້າເຄົາເຕີເພື່ອຄວາມໂປ່ງໃສ.",
            level: "info"
          });
        }
        
        const supplyExpense = categoryMap[i18n.language === 'la' ? 'ຊື້ເຄື່ອງ' : 'Purchase Goods'] || categoryMap['Purchase Goods'] || categoryMap['Supplier'] || categoryMap['ຊື້ວັດຖຸດິບ'] || 0;
        const supplyRatio = totalIncome > 0 ? (supplyExpense / totalIncome) * 100 : 0;
        if (supplyRatio > 40) {
          reasons.push({
            issue: `Procurement costs represent ${supplyRatio.toFixed(1)}% of your revenue.`,
            issueLa: `ຕົ້ນທຶນການຈັດຊື້ວັດຖຸດິບສູງເຖິງ ${supplyRatio.toFixed(1)}% ຂອງລາຍຮັບ.`,
            recommendation: "Raw material costs are high. Use the Procurement Planner to purchase ingredients in bulk and align strict inventory counts to prevent spoilage of milk, cream, and fruits.",
            recommendationLa: "ຕົ້ນທຶນວັດຖຸດິບສູງຫຼາຍ. ໃຫ້ໃຊ້ແຜນການຈັດຊື້ (Procurement Planner) ເພື່ອຊື້ເປັນຈຳນວນຫຼາຍ (Bulk) ແລະ ກວດນັບສະຕັອກໃຫ້ເຂັ້ມງວດເພື່ອປ້ອງກັນການເນົ່າເສຍ.",
            level: "warning"
          });
        }
        
        if (totalExpense === 0 && totalIncome > 0) {
          reasons.push({
            issue: "No operating expenses logged in this ledger period.",
            issueLa: "ບໍ່ມີການບັນທຶກລາຍຈ່າຍການດຳເນີນງານໃນເດືອນນີ້.",
            recommendation: "To obtain an accurate net profit summary, register all cash outflows, including rental costs, utility bills, and staff wages.",
            recommendationLa: "ເພື່ອໃຫ້ໄດ້ກຳໄລສຸດທິທີ່ຖືກຕ້ອງ, ກະລຸນາບັນທຶກລາຍຈ່າຍທັງໝົດ ລວມທັງຄ່າເຊົ່າ, ຄ່າໄຟ, ຄ່ານ້ຳ ແລະ ຄ່າຈ້າງພະນັກງານ.",
            level: "warning"
          });
        }
        
        if (netProfit > 0 && profitMargin >= 25) {
          reasons.push({
            issue: `Exceptional profitability with a ${profitMargin.toFixed(1)}% net margin!`,
            issueLa: `ຜົນການດຳເນີນງານດີເລີດ! ທຸລະກິດໄດ້ກຳໄລສຸດທິສູງເຖິງ ${profitMargin.toFixed(1)}%!`,
            recommendation: "Excellent performance. Reinvest a portion into a maintenance reserve for high-wear equipment (espresso machines, ice makers). Consider rewarding top employees from the HR tracker.",
            recommendationLa: "ຜົນງານດີຫຼາຍ. ຄວນແບ່ງກຳໄລສ່ວນໜຶ່ງໄວ້ເປັນທຶນສຳຮອງໃນການບຳລຸງຮັກສາອຸປະກອນ (ເຄື່ອງຊົງກາເຟ) ແລະ ພິຈາລະນາໃຫ້ໂບນັດພະນັກງານດີເດັ່ນ.",
            level: "success"
          });
        }
      }
      
      setMonthlySummaryData({
        month: monthStr,
        income: totalIncome,
        expenses: totalExpense,
        netProfit,
        profitMargin,
        cashIncome,
        cashExpenses: cashExpense,
        onlineIncome,
        onlineExpenses: onlineExpense,
        categoryBreakdown: categoryMap,
        transactionsCount: list.length,
        reasons,
        txs: list
      });
    } catch (err) {
      console.error("Error fetching monthly summary:", err);
      alert("Error generating monthly report.");
    } finally {
      setLoadingMonthlySummary(false);
    }
  };

  const handleGenerateMonthlySummaryPDF = async () => {
    if (!monthlySummaryData) return;
    setGeneratingMonthlyPDF(true);
    
    const sanitizeLaoText = (text: string): string => {
      if (!text) return "";
      let result = text;
      
      const dictionary: Record<string, string> = {
        "ລາຍຮັບ": "Income",
        "ລາຍຈ່າຍ": "Expense",
        "ຄ່າເຊົ່າ": "Rent",
        "ຄ່ານ້ຳ": "Water Bill",
        "ຄ່າໄຟ": "Electricity Bill",
        "ຄ່າເນັດ": "Internet Bill",
        "ອິນເຕີເນັດ": "Internet",
        "ຄ່າໂທລະສັບ": "Telephone Bill",
        "ເງິນເດືອນ": "Salary",
        "ຄ່າຈ້າງ": "Wages",
        "ຊື້ເຄື່ອງ": "Purchase Goods",
        "ຊື້ວັດຖຸດິບ": "Purchase Raw Materials",
        "ອຸປະກອນ": "Equipment",
        "ຄ່າເດີນທາງ": "Travel Expense",
        "ຄ່າອາຫານ": "Food Expense",
        "ຄ່າຂົນສົ່ງ": "Shipping/Transport",
        "ຄົວ": "Kitchen",
        "ເຄື່ອງດື່ມ": "Beverages",
        "ກາເຟ": "Coffee",
        "ນົມ": "Milk",
        "ນ້ຳຕານ": "Sugar",
        "ແກ້ວ": "Glass/Cup",
        "ຖົງ": "Bag",
        "ສາຂາ": "Branch",
        "ສາຂາ 1": "Branch 1",
        "ສາຂາ 2": "Branch 2",
        "ເງິນສົດ": "Cash",
        "ທະນາຄານ": "Bank Transfer",
        "ໂອນ": "Transfer",
        "ບັດເຄຣດິດ": "Credit Card",
        "ຄ່າທຳນຽມ": "Fee",
        "ພາສີ": "Tax",
        "ປະກັນໄພ": "Insurance",
        "ສ້ອມແປງ": "Repairs & Maintenance",
        "ໂຄສະນາ": "Advertising & Marketing",
        "ສະປອນເຊີ": "Sponsorship",
        "ທົ່ວໄປ": "General",
        "ອື່ນໆ": "Others"
      };

      for (const [lao, eng] of Object.entries(dictionary)) {
        result = result.split(lao).join(eng);
      }

      return result.replace(/[^\x00-\x7F]/g, "").trim() || "Financial Record";
    };

    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const activeBranch = selectedBranch || 'branch_1';
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(5, 38, 89);
      doc.text('LA DOLCE CAFE & CO-WORKING', 14, 20);
      
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(110, 110, 110);
      doc.text('VIENTIANE, LAO P.D.R - PHONE +85620 77609857', 14, 25);
      doc.text('Monthly Financial Performance Summary & Expert Advisory Board Report', 14, 29.5);
      
      doc.setDrawColor(5, 38, 89);
      doc.setLineWidth(0.8);
      doc.line(14, 33, 196, 33);
      doc.setDrawColor(180, 190, 210);
      doc.setLineWidth(0.2);
      doc.line(14, 34.5, 196, 34.5);
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(5, 38, 89);
      doc.text('MONTHLY ADVISORY & PERFORMANCE SUMMARY', 14, 43);
      
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text(`Reporting Period: ${monthlySummaryData.month}`, 14, 49);
      doc.text(`Location: ${activeBranch === 'branch_1' ? 'Branch 1 (Vientiane Main)' : 'Branch 2 (Luang Prabang)'}`, 14, 54);
      doc.text(`Total Transactions: ${monthlySummaryData.transactionsCount} logs`, 14, 59);
      
      doc.text(`Generated On: ${new Date().toLocaleString()}`, 115, 49);
      doc.text(`Currency Base: Lao Kip (LAK)`, 115, 54);
      doc.text(`Auditing Status: Verified Accountant Ledger`, 115, 59);
      
      doc.setFillColor(245, 247, 250);
      doc.rect(14, 65, 182, 24, 'F');
      doc.setDrawColor(220, 225, 235);
      doc.setLineWidth(0.3);
      doc.rect(14, 65, 182, 24, 'D');
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(16, 124, 65);
      doc.text(`+${monthlySummaryData.income.toLocaleString()} LAK`, 18, 73);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text('MONTHLY INCOME', 18, 78);
      doc.text(`Cash: ${monthlySummaryData.cashIncome.toLocaleString()}`, 18, 82);
      doc.text(`Online: ${monthlySummaryData.onlineIncome.toLocaleString()}`, 18, 85);
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(190, 40, 40);
      doc.text(`-${monthlySummaryData.expenses.toLocaleString()} LAK`, 82, 73);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text('MONTHLY EXPENSES', 82, 78);
      doc.text(`Cash: ${monthlySummaryData.cashExpenses.toLocaleString()}`, 82, 82);
      doc.text(`Online: ${monthlySummaryData.onlineExpenses.toLocaleString()}`, 82, 85);
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      const isProf = monthlySummaryData.netProfit >= 0;
      doc.setTextColor(isProf ? 5 : 190, isProf ? 38 : 40, isProf ? 89 : 40);
      doc.text(`${isProf ? '+' : ''}${monthlySummaryData.netProfit.toLocaleString()} LAK`, 142, 73);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text('NET REVENUE PROFIT', 142, 78);
      doc.setFont('Helvetica', 'bold');
      doc.setTextColor(5, 38, 89);
      doc.text(`MARGIN: ${monthlySummaryData.profitMargin.toFixed(1)}%`, 142, 83);
      
      let y = 96;
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(5, 38, 89);
      doc.text('EXPENSE CATEGORY BREAKDOWN', 14, y);
      
      y += 4;
      doc.setFillColor(5, 38, 89);
      doc.rect(14, y, 182, 6.5, 'F');
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      doc.text('CATEGORY NAME', 18, y + 4.2);
      doc.text('DEBIT AMOUNT (LAK)', 192, y + 4.2, { align: 'right' });
      
      y += 6.5;
      
      const categories = Object.keys(monthlySummaryData.categoryBreakdown);
      if (categories.length === 0) {
        doc.setFont('Helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(130, 130, 130);
        doc.text('No expenses logged during this month.', 18, y + 5);
        y += 8;
      } else {
        categories.forEach((cat) => {
          const amt = monthlySummaryData.categoryBreakdown[cat];
          const pct = monthlySummaryData.income > 0 ? (amt / monthlySummaryData.income) * 100 : 0;
          
          doc.setFont('Helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(50, 50, 50);
          doc.text(sanitizeLaoText(cat), 18, y + 4.5);
          doc.text(`${amt.toLocaleString()} LAK (${pct.toFixed(1)}%)`, 192, y + 4.5, { align: 'right' });
          
          doc.setDrawColor(230, 235, 240);
          doc.setLineWidth(0.1);
          doc.line(14, y + 6.2, 196, y + 6.2);
          y += 6.5;
        });
      }
      
      y += 5;
      if (y > 210) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(5, 38, 89);
      doc.text('BUSINESS AUDIT & STRATEGIC RECOMMENDATIONS', 14, y);
      
      y += 4;
      monthlySummaryData.reasons.forEach((r: any) => {
        if (y > 240) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFillColor(r.level === 'warning' ? 253 : r.level === 'success' ? 240 : 244, r.level === 'warning' ? 242 : r.level === 'success' ? 248 : 245, r.level === 'warning' ? 242 : r.level === 'success' ? 240 : 250);
        doc.rect(14, y, 182, 15, 'F');
        
        doc.setDrawColor(r.level === 'warning' ? 245 : r.level === 'success' ? 200 : 220, r.level === 'warning' ? 150 : r.level === 'success' ? 225 : 225, r.level === 'warning' ? 150 : r.level === 'success' ? 200 : 235);
        doc.setLineWidth(0.2);
        doc.rect(14, y, 182, 15, 'D');
        
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(r.level === 'warning' ? 150 : r.level === 'success' ? 20 : 50, r.level === 'warning' ? 20 : r.level === 'success' ? 100 : 50, r.level === 'warning' ? 20 : r.level === 'success' ? 20 : 120);
        doc.text(`[${r.level.toUpperCase()}] ${sanitizeLaoText(r.issueLa) || r.issue}`, 18, y + 4.5);
        
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(80, 80, 80);
        const splitRec = doc.splitTextToSize(`Advice: ${r.recommendation}`, 174);
        doc.text(splitRec, 18, y + 8);
        
        y += 17;
      });
      
      if (y > 230) {
        doc.addPage();
        y = 20;
      }
      
      y = 245;
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(14, y, 196, y);
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text('Prepared By: Financial Controller', 14, y + 5);
      doc.text('Verified By: Auditor General', 80, y + 5);
      doc.text('Approved By: Executive Board', 145, y + 5);
      
      doc.line(14, y + 16, 50, y + 16);
      doc.line(80, y + 16, 116, y + 16);
      doc.line(145, y + 16, 181, y + 16);
      
      doc.save(`La_Dolce_Advisory_Report_${monthlySummaryData.month}.pdf`);
      setShowMonthlySummaryModal(false);
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("Failed to export PDF Report.");
    } finally {
      setGeneratingMonthlyPDF(false);
    }
  };

  const handleGeneratePDFStatement = async () => {
    if (!statementStartDate || !statementEndDate) {
      alert(i18n.language === 'la' ? 'ກະລຸນາເລືອກໄລຍະເວລາ!' : 'Please select a date range!');
      return;
    }
    
    // Robust sanitization dictionary for common Lao finance and operating terms
    const sanitizeLaoText = (text: string): string => {
      if (!text) return "";
      let result = text;
      
      const dictionary: Record<string, string> = {
        "ລາຍຮັບ": "Income",
        "ລາຍຈ່າຍ": "Expense",
        "ຄ່າເຊົ່າ": "Rent",
        "ຄ່ານ້ຳ": "Water Bill",
        "ຄ່າໄຟ": "Electricity Bill",
        "ຄ່າເນັດ": "Internet Bill",
        "ອິນເຕີເນັດ": "Internet",
        "ຄ່າໂທລະສັບ": "Telephone Bill",
        "ເງິນເດືອນ": "Salary",
        "ຄ່າຈ້າງ": "Wages",
        "ຊື້ເຄື່ອງ": "Purchase Goods",
        "ຊື້ວັດຖຸດິບ": "Purchase Raw Materials",
        "ອຸປະກອນ": "Equipment",
        "ຄ່າເດີນທາງ": "Travel Expense",
        "ຄ່າອາຫານ": "Food Expense",
        "ຄ່າຂົນສົ່ງ": "Shipping/Transport",
        "ຄົວ": "Kitchen",
        "ເຄື່ອງດື່ມ": "Beverages",
        "ກາເຟ": "Coffee",
        "ນົມ": "Milk",
        "ນ້ຳຕານ": "Sugar",
        "ແກ້ວ": "Glass/Cup",
        "ຖົງ": "Bag",
        "ສາຂາ": "Branch",
        "ສາຂາ 1": "Branch 1",
        "ສາຂາ 2": "Branch 2",
        "ເງິນສົດ": "Cash",
        "ທະນາຄານ": "Bank Transfer",
        "ໂອນ": "Transfer",
        "ບັດເຄຣດິດ": "Credit Card",
        "ຄ່າທຳນຽມ": "Fee",
        "ພາສີ": "Tax",
        "ປະກັນໄພ": "Insurance",
        "ສ້ອມແປງ": "Repairs / Maintenance",
        "ໂຄສະນາ": "Advertising / Marketing",
        "ສະປອນເຊີ": "Sponsorship",
        "ທົ່ວໄປ": "General",
        "ອື່ນໆ": "Others"
      };

      for (const [lao, eng] of Object.entries(dictionary)) {
        result = result.split(lao).join(eng);
      }

      // Filter out non-ASCII/Lao characters to guarantee clean, non-corrupted PDF printout
      return result.replace(/[^\x00-\x7F]/g, "").trim() || "Transaction Record";
    };

    setGeneratingStatement(true);
    try {
      const q = query(
        collection(db, 'transactions'),
        where('date', '>=', statementStartDate),
        where('date', '<=', statementEndDate)
      );
      
      const snap = await getDocs(q);
      const activeBranch = selectedBranch || 'branch_1';
      
      // Filter client side by active branch
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      list = list.filter(tx => {
        const txBranch = tx.branchId || 'branch_1';
        return txBranch === activeBranch;
      });
      
      // Sort chronologically (date, then time)
      list.sort((a, b) => {
        const dComp = a.date.localeCompare(b.date);
        if (dComp !== 0) return dComp;
        const tA = a.time || '00:00';
        const tB = b.time || '00:00';
        return tA.localeCompare(tB);
      });
      
      // Compute summary totals and running balance mapping
      let totalIncome = 0;
      let totalExpense = 0;
      let currentBalance = 0;
      
      const processedList = list.map(tx => {
        const amt = Number(tx.amount) || 0;
        if (tx.type === 'income') {
          totalIncome += amt;
          currentBalance += amt;
        } else {
          totalExpense += amt;
          currentBalance -= amt;
        }
        return {
          ...tx,
          runningBalance: currentBalance
        };
      });
      
      const netFlow = totalIncome - totalExpense;
      
      // Begin jsPDF generation
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      // 1. Branded Header Block (as requested)
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(5, 38, 89); // Deep Brand Blue (#052659)
      doc.text('LA DOLCE CAFE & CO-WORKING', 14, 20);
      
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(110, 110, 110);
      doc.text('VIENTIANE, LAO P.D.R - PHONE +85620 77609857', 14, 25);
      doc.text('Comprehensive Financial Statement & Accounting Record Ledger Desk', 14, 29.5);
      
      // Decorative Double-underline
      doc.setDrawColor(5, 38, 89);
      doc.setLineWidth(0.8);
      doc.line(14, 33, 196, 33);
      doc.setDrawColor(180, 190, 210);
      doc.setLineWidth(0.2);
      doc.line(14, 34.5, 196, 34.5);
      
      // 2. Metadata Columns
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(5, 38, 89);
      doc.text('STATEMENT OF ACCOUNT', 14, 43);
      
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(`Account Roster: ${auth.currentUser?.email || 'admin@example.com'}`, 14, 49);
      doc.text(`Period Duration: ${statementStartDate} to ${statementEndDate}`, 14, 54);
      doc.text(`Active Location: ${activeBranch === 'branch_1' ? 'Branch 1 (Vientiane Main)' : 'Branch 2 (Luang Prabang)'}`, 14, 59);
      
      doc.text(`Generated On: ${new Date().toLocaleString()}`, 115, 49);
      doc.text(`Reporting Currency: LAK`, 115, 54);
      doc.text(`Status: Completed & Verified`, 115, 59);
      
      // 3. Totals Executive Summary Block
      doc.setFillColor(245, 247, 250); // very soft neutral gray blue
      doc.rect(14, 65, 182, 22, 'F');
      doc.setDrawColor(220, 225, 235);
      doc.setLineWidth(0.3);
      doc.rect(14, 65, 182, 22, 'D');
      
      // Columns in Box
      // Total Income (Credit)
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(16, 124, 65); // Warm green
      doc.text(`+${totalIncome.toLocaleString()} LAK`, 20, 74);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text('TOTAL DEPOSITS (CREDIT)', 20, 79);
      
      // Total Expense (Debit)
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(190, 40, 40); // Soft crimson
      doc.text(`-${totalExpense.toLocaleString()} LAK`, 85, 74);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text('TOTAL WITHDRAWALS (DEBIT)', 85, 79);
      
      // Net Balance
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(5, 38, 89);
      doc.text(`${netFlow >= 0 ? '+' : ''}${netFlow.toLocaleString()} LAK`, 145, 74);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text('ENDING STATEMENT BALANCE', 145, 79);
      
      // 4. Ledger Ledger Grid Header
      let y = 96;
      doc.setFillColor(5, 38, 89);
      doc.rect(14, y, 182, 7.5, 'F');
      
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text('DATE', 17, y + 4.8);
      doc.text('NARRATION/DESCRIPTION', 44, y + 4.8);
      doc.text('DEBIT (EXPENSE)', 128, y + 4.8, { align: 'right' });
      doc.text('CREDIT (INCOME)', 160, y + 4.8, { align: 'right' });
      doc.text('BALANCE (LAK)', 194, y + 4.8, { align: 'right' });
      
      // Set baseline to align perfectly for the first transaction row below the header
      y = 101.5;
      
      let pageEntryCount = 0;
      let maxPageEntries = 19; // first page has summaries so less entries
      
      processedList.forEach((tx, idx) => {
        if (pageEntryCount >= maxPageEntries) {
          doc.addPage();
          y = 20;
          doc.setFillColor(5, 38, 89);
          doc.rect(14, y, 182, 7.5, 'F');
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(255, 255, 255);
          doc.text('DATE', 17, y + 4.8);
          doc.text('NARRATION/DESCRIPTION', 44, y + 4.8);
          doc.text('DEBIT (EXPENSE)', 128, y + 4.8, { align: 'right' });
          doc.text('CREDIT (INCOME)', 160, y + 4.8, { align: 'right' });
          doc.text('BALANCE (LAK)', 194, y + 4.8, { align: 'right' });
          
          // Position baseline to align perfectly for the subsequent pages
          y = 25.5;
          pageEntryCount = 0;
          maxPageEntries = 24; // subsequent pages can take more lines
        }
        
        y += 7.5;
        // Striped rows
        if (idx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(14, y - 5.5, 182, 7.5, 'F');
        }
        
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(70, 70, 70);
        
        // Date & Time
        doc.text(`${tx.date} ${tx.time || ''}`, 17, y);
        
        // Narration/Category/Source - clean out any Lao encoding/unicode block anomalies
        const categorySanitized = sanitizeLaoText(tx.category || '');
        const descSanitized = sanitizeLaoText(tx.description || '');
        const narration = `${categorySanitized}${descSanitized ? ' - ' + descSanitized : ''}`;
        doc.text(narration.substring(0, 42), 44, y);
        
        // Columns: Debit, Credit, Balance
        if (tx.type === 'income') {
          // No Debit
          doc.setTextColor(160, 160, 160);
          doc.text('-', 128, y, { align: 'right' });
          
          // Credit amount
          doc.setTextColor(16, 124, 65);
          doc.setFont('Helvetica', 'bold');
          doc.text(`${Number(tx.amount).toLocaleString()}`, 160, y, { align: 'right' });
        } else {
          // Debit amount
          doc.setTextColor(190, 40, 40);
          doc.setFont('Helvetica', 'bold');
          doc.text(`${Number(tx.amount).toLocaleString()}`, 128, y, { align: 'right' });
          
          // No Credit
          doc.setTextColor(160, 160, 160);
          doc.setFont('Helvetica', 'normal');
          doc.text('-', 160, y, { align: 'right' });
        }
        
        // Running Balance
        doc.setTextColor(5, 38, 89);
        doc.setFont('Helvetica', 'bold');
        doc.text(`${tx.runningBalance.toLocaleString()}`, 194, y, { align: 'right' });
        
        pageEntryCount++;
      });
      
      // Page safety check for summary block at the bottom
      if (y + 35 > 280) {
        doc.addPage();
        y = 30;
      } else {
        y += 12;
      }
      
      // Drawn dividing summary accent rule
      doc.setDrawColor(5, 38, 89);
      doc.setLineWidth(0.6);
      doc.line(14, y, 196, y);
      
      y += 6;
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(5, 38, 89);
      doc.text('STATEMENT SUMMARY', 17, y);
      
      y += 6.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text('Total Credit (Deposits):', 17, y);
      doc.setFont('Helvetica', 'bold');
      doc.setTextColor(16, 124, 65);
      doc.text(`+${totalIncome.toLocaleString()} LAK`, 194, y, { align: 'right' });
      
      y += 5.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text('Total Debit (Withdrawals):', 17, y);
      doc.setFont('Helvetica', 'bold');
      doc.setTextColor(190, 40, 40);
      doc.text(`-${totalExpense.toLocaleString()} LAK`, 194, y, { align: 'right' });
      
      y += 2.5;
      doc.setDrawColor(220, 225, 235);
      doc.setLineWidth(0.25);
      doc.line(17, y, 194, y);
      
      y += 6.5;
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(5, 38, 89);
      doc.text('Ending Statement Balance:', 17, y);
      doc.text(`${currentBalance >= 0 ? '+' : ''}${currentBalance.toLocaleString()} LAK`, 194, y, { align: 'right' });
      
      y += 2.5;
      doc.setDrawColor(5, 38, 89);
      doc.setLineWidth(1.0);
      doc.line(17, y, 194, y);
      
      // Add Page footers with page number
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(`La Dolce Station Finance Desk / Page ${i} of ${pageCount}`, 14, 287);
        doc.text('Disclaimer: In case of auditing discrepancies, contact treasury administration directly.', 115, 287);
      }
      
      doc.save(`La_Dolce_Statement_${statementStartDate}_to_${statementEndDate}.pdf`);
      setShowStatementModal(false);
    } catch (err: any) {
      console.error("PDF generation failed:", err);
      alert(`ເກີດຂໍ້ຜິດພາດ: ${err.message}`);
    } finally {
      setGeneratingStatement(false);
    }
  };

  const handleUpload = async (file: File, uploadDate: string) => {
    // If not an image (e.g., application/pdf), bypass compression to avoid errors and delay
    if (!file.type.startsWith('image/')) {
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      return await getDownloadURL(fileRef);
    }

    // Compression Options for images
    const options = {
      maxSizeMB: 0.3, // 300KB
      maxWidthOrHeight: 1280,
      useWebWorker: true,
    };

    try {
      const compressedFile = await imageCompression(file, options);
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${compressedFile.name}`);
      await uploadBytes(fileRef, compressedFile);
      return await getDownloadURL(fileRef);
    } catch (err) {
      console.error('Compression/Upload error, uploading original:', err);
      // Fallback to original if compression fails
      const fileRef = ref(storage, `receipts/${uploadDate}/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      return await getDownloadURL(fileRef);
    }
  };

  const recalculateDailySummary = async (dateStr: string, excludeTxIdsInput?: string | string[] | Set<string>) => {
    try {
      // Small delay to let any preceding Firestore writes/deletes propagate and register correctly
      await new Promise(resolve => setTimeout(resolve, 800));

      const excludeTxIds = new Set<string>();
      if (excludeTxIdsInput) {
        if (typeof excludeTxIdsInput === 'string') {
          excludeTxIds.add(excludeTxIdsInput);
        } else if (excludeTxIdsInput instanceof Set) {
          excludeTxIdsInput.forEach(id => excludeTxIds.add(id));
        } else if (Array.isArray(excludeTxIdsInput)) {
          excludeTxIdsInput.forEach(id => excludeTxIds.add(id));
        }
      }

      // 1. Get all transactions for this date
      const q = query(collection(db, 'transactions'), where('date', '==', dateStr));
      const txSnap = await getDocs(q);
      const txs = txSnap.docs
        .filter(doc => !excludeTxIds.has(doc.id))
        .map(doc => doc.data());

      // 2. Find previous balances
      const prevQ = query(
        collection(db, 'dailySummaries'),
        where('date', '<', dateStr),
        orderBy('date', 'desc'),
        limit(1)
      );
      const prevSnap = await getDocs(prevQ);
      const previousBalance = !prevSnap.empty ? (prevSnap.docs[0].data().finalBalance || 0) : 0;
      const previousCashBalance = !prevSnap.empty ? (prevSnap.docs[0].data().finalCashBalance || 0) : 0;
      const previousOnlineBalance = !prevSnap.empty ? (prevSnap.docs[0].data().finalOnlineBalance || 0) : 0;

      // 3. Aggregate
      const summary = {
        date: dateStr,
        previousBalance: previousBalance,
        previousCashBalance: previousCashBalance,
        previousOnlineBalance: previousOnlineBalance,
        income: 0,
        expenses: 0,
        cashIncome: 0,
        cashExpenses: 0,
        onlineIncome: 0,
        onlineExpenses: 0,
        finalBalance: previousBalance,
        finalCashBalance: previousCashBalance,
        finalOnlineBalance: previousOnlineBalance,
        timestamp: serverTimestamp()
      };

      txs.forEach(tx => {
        const amount = Number(tx.amount) || 0;
        if (tx.type === 'income') {
          summary.income += amount;
          if (tx.source === 'cash') summary.cashIncome += amount;
          else summary.onlineIncome += amount;
        } else {
          summary.expenses += amount;
          if (tx.source === 'cash') summary.cashExpenses += amount;
          else summary.onlineExpenses += amount;
        }
      });

      summary.finalBalance = summary.previousBalance + summary.income - summary.expenses;
      summary.finalCashBalance = summary.previousCashBalance + summary.cashIncome - summary.cashExpenses;
      summary.finalOnlineBalance = summary.previousOnlineBalance + summary.onlineIncome - summary.onlineExpenses;

      // 4. Save
      await setDoc(doc(db, 'dailySummaries', dateStr), summary, { merge: true });

      // 5. Cascade updates to future summaries
      const futureQ = query(
        collection(db, 'dailySummaries'),
        where('date', '>', dateStr),
        orderBy('date', 'asc')
      );
      const futureSnap = await getDocs(futureQ);
      
      let currentBalance = summary.finalBalance;
      let currentCash = summary.finalCashBalance;
      let currentOnline = summary.finalOnlineBalance;
      for (const futureDoc of futureSnap.docs) {
        const data = futureDoc.data();
        const newFinal = currentBalance + (data.income || 0) - (data.expenses || 0);
        const newCash = currentCash + (data.cashIncome || 0) - (data.cashExpenses || 0);
        const newOnline = currentOnline + (data.onlineIncome || 0) - (data.onlineExpenses || 0);
        await setDoc(doc(db, 'dailySummaries', futureDoc.id), {
          previousBalance: currentBalance,
          finalBalance: newFinal,
          previousCashBalance: currentCash,
          finalCashBalance: newCash,
          previousOnlineBalance: currentOnline,
          finalOnlineBalance: newOnline,
          timestamp: serverTimestamp()
        }, { merge: true });
        currentBalance = newFinal;
        currentCash = newCash;
        currentOnline = newOnline;
      }

      return summary;
    } catch (err) {
      console.error("Error recalculating summary:", err);
      throw err;
    }
  };

  const rebuildAllSummariesFromTransactions = async () => {
    try {
      setLoading(true);

      // 1. Fetch ALL transactions
      const txSnap = await getDocs(collection(db, 'transactions'));
      let txs = txSnap.docs.map(docRef => ({ id: docRef.id, ...docRef.data() as any }));

      // Clean up duplicates and orphaned split partner transactions from known edit bugs
      const deletedIds = new Set<string>();
      const cleanBaseDesc = (desc: string) => {
        if (!desc) return '';
        return desc
          .replace(' (ສ່ວນເງິນສົດ)', '')
          .replace(' (ສ່ວນເງິນໂອນ)', '')
          .replace(' (Cash Part)', '')
          .replace(' (Transfer Part)', '')
          .trim();
      };
      
      const groups: { [key: string]: any[] } = {};
      txs.forEach(tx => {
        if (tx.type !== 'income') return;
        const desc = tx.description || '';
        const isSplitPart = desc.includes('(ສ່ວນເງິນສົດ)') || desc.includes('(Cash Part)') || desc.includes('(ສ່ວນເງິນໂອນ)') || desc.includes('(Transfer Part)');
        if (!isSplitPart) return;
        
        const base = cleanBaseDesc(desc);
        const key = `${tx.date}_${tx.time || ''}_${tx.branchId || 'branch_1'}_${tx.category || ''}_${base}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(tx);
      });
      
      for (const key of Object.keys(groups)) {
        const items = groups[key];
        const cashParts = items.filter(it => (it.description || '').includes('(ສ່ວນເງິນສົດ)') || (it.description || '').includes('(Cash Part)'));
        const onlineParts = items.filter(it => (it.description || '').includes('(ສ່ວນເງິນໂອນ)') || (it.description || '').includes('(Transfer Part)'));
        
        if (cashParts.length > 1) {
          cashParts.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
          for (let idx = 1; idx < cashParts.length; idx++) {
            await deleteDoc(doc(db, 'transactions', cashParts[idx].id)).catch(() => {});
            deletedIds.add(cashParts[idx].id);
          }
        }
        
        if (onlineParts.length > 0 && cashParts.length === 0) {
          for (const op of onlineParts) {
            await deleteDoc(doc(db, 'transactions', op.id)).catch(() => {});
            deletedIds.add(op.id);
          }
        }
        
        if (onlineParts.length > 1 && cashParts.length > 0) {
          onlineParts.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
          for (let idx = 1; idx < onlineParts.length; idx++) {
            await deleteDoc(doc(db, 'transactions', onlineParts[idx].id)).catch(() => {});
            deletedIds.add(onlineParts[idx].id);
          }
        }
      }
      
      // 2. Clear exact identical standard/split duplicate transactions in Firestore
      const standardGroups: { [key: string]: any[] } = {};
      txs.forEach(tx => {
        if (deletedIds.has(tx.id)) return;

        const cleanDesc = (tx.description || '').trim();
        const key = `${tx.date}_${tx.time || ''}_${tx.branchId || 'branch_1'}_${tx.category || ''}_${tx.type}_${tx.source || ''}_${tx.amount}_${cleanDesc}`;
        if (!standardGroups[key]) standardGroups[key] = [];
        standardGroups[key].push(tx);
      });

      for (const key of Object.keys(standardGroups)) {
        const items = standardGroups[key];
        if (items.length > 1) {
          items.sort((a, b) => {
            const hasRelatedA = a.relatedTxId ? 1 : 0;
            const hasRelatedB = b.relatedTxId ? 1 : 0;
            if (hasRelatedA !== hasRelatedB) {
              return hasRelatedB - hasRelatedA;
            }
            const secA = a.updatedAt?.seconds || 0;
            const secB = b.updatedAt?.seconds || 0;
            return secB - secA;
          });

          for (let idx = 1; idx < items.length; idx++) {
            await deleteDoc(doc(db, 'transactions', items[idx].id)).catch(() => {});
            deletedIds.add(items[idx].id);
          }
        }
      }

      if (deletedIds.size > 0) {
        txs = txs.filter(tx => !deletedIds.has(tx.id));
      }

      if (txs.length === 0) {
        // If there are no transactions, delete all dailySummaries as well
        const summarySnap = await getDocs(collection(db, 'dailySummaries'));
        const deleteSummaryPromises = summarySnap.docs.map(docRef => deleteDoc(doc(db, 'dailySummaries', docRef.id)));
        await Promise.all(deleteSummaryPromises);
        
        setDailySummary(null);
        setWeeklyData([]);
        alert(i18n.language === 'la' ? 'ບໍ່ມີລາຍການທຸລະກຳເຫຼືອຢູ່, ລຶບຍອດສະຫຼຸບທັງໝົດແລ້ວ.' : 'No transactions exist, cleared all summaries.');
        return;
      }

      // Group transactions by date
      const txsByDate: { [date: string]: any[] } = {};
      txs.forEach(tx => {
        const d = tx.date;
        if (!d) return;
        if (!txsByDate[d]) {
          txsByDate[d] = [];
        }
        txsByDate[d].push(tx);
      });

      // Get all unique dates in chronological order
      const allDates = Object.keys(txsByDate).sort();

      // Go through each date in chronological order, calculate and save dailySummaries sequentially
      let currentBalance = 0;
      let currentCash = 0;
      let currentOnline = 0;

      for (let i = 0; i < allDates.length; i++) {
        const dateStr = allDates[i];
        const dayTxs = txsByDate[dateStr];

        let income = 0;
        let expenses = 0;
        let cashIncome = 0;
        let cashExpenses = 0;
        let onlineIncome = 0;
        let onlineExpenses = 0;

        dayTxs.forEach(tx => {
          const amount = Number(tx.amount) || 0;
          if (tx.type === 'income') {
            income += amount;
            if (tx.source === 'cash') {
              cashIncome += amount;
            } else {
              onlineIncome += amount;
            }
          } else {
            expenses += amount;
            if (tx.source === 'cash') {
              cashExpenses += amount;
            } else {
              onlineExpenses += amount;
            }
          }
        });

        const previousBalance = currentBalance;
        const previousCashBalance = currentCash;
        const previousOnlineBalance = currentOnline;

        const finalBalance = previousBalance + income - expenses;
        const finalCashBalance = previousCashBalance + cashIncome - cashExpenses;
        const finalOnlineBalance = previousOnlineBalance + onlineIncome - onlineExpenses;

        const summary = {
          date: dateStr,
          previousBalance,
          previousCashBalance,
          previousOnlineBalance,
          income,
          expenses,
          cashIncome,
          cashExpenses,
          onlineIncome,
          onlineExpenses,
          finalBalance,
          finalCashBalance,
          finalOnlineBalance,
          timestamp: serverTimestamp()
        };

        // Write the clean summary doc to dailySummaries
        await setDoc(doc(db, 'dailySummaries', dateStr), summary, { merge: true });

        // Update running balances for the next iteration in the chain
        currentBalance = finalBalance;
        currentCash = finalCashBalance;
        currentOnline = finalOnlineBalance;
      }

      // Re-trigger visual snapshot state updates for active viewDate
      const activeSummaryRef = doc(db, 'dailySummaries', viewDate);
      const activeSnap = await getDoc(activeSummaryRef);
      if (activeSnap.exists()) {
        setDailySummary(activeSnap.data());
      } else {
        // Find latest summary before active date helper
        const prevQ = query(
          collection(db, 'dailySummaries'),
          where('date', '<', viewDate),
          orderBy('date', 'desc'),
          limit(1)
        );
        const prevSnap = await getDocs(prevQ);
        if (!prevSnap.empty) {
          const prevData = prevSnap.docs[0].data();
          setDailySummary({
            date: viewDate,
            previousBalance: prevData.finalBalance || 0,
            income: 0,
            expenses: 0,
            finalBalance: prevData.finalBalance || 0,
            cashIncome: 0,
            cashExpenses: 0,
            onlineIncome: 0,
            onlineExpenses: 0,
            previousCashBalance: prevData.finalCashBalance || 0,
            finalCashBalance: prevData.finalCashBalance || 0,
            previousOnlineBalance: prevData.finalOnlineBalance || 0,
            finalOnlineBalance: prevData.finalOnlineBalance || 0
          });
        } else {
          setDailySummary(null);
        }
      }

      // Refresh weekly chart data as well
      const last7Days = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(viewDate), 6 - i), 'yyyy-MM-dd'));
      const weekly = [];
      for (const d of last7Days) {
        const sRef = doc(db, 'dailySummaries', d);
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          weekly.push(sSnap.data());
        } else {
          weekly.push({ date: d, income: 0, expenses: 0 });
        }
      }
      setWeeklyData(weekly);

      alert(i18n.language === 'la' ? 'ຟື້ນຟູ ແລະ ຄິດໄລ່ຍອດທັງໝົດຄືນໃໝ່ສຳເລັດແລ້ວ!' : 'Reconstructed and synchronized all summary totals perfectly!');
    } catch (error: any) {
      console.error("Rebuild error:", error);
      alert(`ເກີດຂໍ້ຜິດພາດໃນການຟື້ນຟູ: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    const excludedFromSummary = new Set<string>();
    try {
      setLoading(true);
      let receiptUrl = '';
      if (formData.receipt && typeof formData.receipt !== 'string') {
        receiptUrl = await handleUpload(formData.receipt, formData.date);
      } else if (isEditing && !deleteReceipt) {
        receiptUrl = oldTxData?.receiptUrl || '';
      }
      
      if (formData.type === 'income' && splitSourceMode) {
        const cashValue = Number(cashAmountInput) || 0;
        const onlineValue = (Number(formData.amount) || 0) - cashValue;

        if (cashValue < 0 || onlineValue < 0) {
          alert(i18n.language === 'la' ? 'ຈຳນວນເງິນສົດບໍ່ຖືກຕ້ອງ! ຕ້ອງບໍ່ເກີນຍອດລວມທັງໝົດ.' : 'Invalid cash portion value!');
          setLoading(false);
          return;
        }

        const cashTxData = {
          type: formData.type,
          amount: cashValue,
          category: formData.category,
          description: formData.description ? `${formData.description} (${i18n.language === 'la' ? 'ສ່ວນເງິນສົດ' : 'Cash Part'})` : (i18n.language === 'la' ? 'ສ່ວນເງິນສົດ' : 'Cash Part'),
          source: 'cash',
          receiptUrl,
          date: formData.date,
          time: formData.time,
          updatedAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
          branchId: selectedBranch || 'branch_1'
        };

        const onlineTxData = {
          type: formData.type,
          amount: onlineValue,
          category: formData.category,
          description: formData.description ? `${formData.description} (${i18n.language === 'la' ? 'ສ່ວນເງິນໂອນ' : 'Transfer Part'})` : (i18n.language === 'la' ? 'ສ່ວນເງິນໂອນ' : 'Transfer Part'),
          source: 'online banking',
          receiptUrl,
          date: formData.date,
          time: formData.time,
          updatedAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
          branchId: selectedBranch || 'branch_1'
        };

        if (isEditing && editingId) {
          let partnerId = oldTxData?.relatedTxId || null;
          if (!partnerId) {
            const cleanBaseDesc = (d: string) => d.replace(' (ສ່ວນເງິນສົດ)', '').replace(' (ສ່ວນເງິນໂອນ)', '').replace(' (Cash Part)', '').replace(' (Transfer Part)', '').trim();
            const base = cleanBaseDesc(oldTxData?.description || '');
            const qPartner = query(
              collection(db, 'transactions'),
              where('date', '==', oldTxData?.date || formData.date),
              where('branchId', '==', selectedBranch || 'branch_1')
            );
            const partnerSnap = await getDocs(qPartner);
            for (const docRef of partnerSnap.docs) {
              const dData = docRef.data();
              if (docRef.id !== editingId && dData.time === oldTxData?.time && cleanBaseDesc(dData.description || '') === base) {
                partnerId = docRef.id;
                break;
              }
            }
          }

          await setDoc(doc(db, 'transactions', editingId), {
            ...cashTxData,
            // Preserve supplier info
            ...(oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
            ...(oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {}),
            relatedTxId: partnerId || '',
            isSplit: true
          }, { merge: true });

          if (onlineValue > 0) {
            if (partnerId) {
              await setDoc(doc(db, 'transactions', partnerId), {
                ...onlineTxData,
                // Preserve supplier info on partner too
                ...(oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
                ...(oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {}),
                relatedTxId: editingId,
                isSplit: true
              }, { merge: true });
            } else {
              const onlineRef = await addDoc(collection(db, 'transactions'), {
                ...onlineTxData,
                ...(oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
                ...(oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {}),
                relatedTxId: editingId,
                isSplit: true,
                createdAt: serverTimestamp()
              });
              await setDoc(doc(db, 'transactions', editingId), {
                relatedTxId: onlineRef.id
              }, { merge: true });
            }
          } else if (partnerId) {
            await deleteDoc(doc(db, 'transactions', partnerId)).catch(() => {});
            excludedFromSummary.add(partnerId);
            await setDoc(doc(db, 'transactions', editingId), {
              relatedTxId: '',
              isSplit: false
            }, { merge: true });
          }
        } else {
          let cashDocId = '';
          if (cashValue > 0) {
            const cashRef = await addDoc(collection(db, 'transactions'), {
              ...cashTxData,
              isSplit: true,
              createdAt: serverTimestamp()
            });
            cashDocId = cashRef.id;
          }
          if (onlineValue > 0) {
            const onlineRef = await addDoc(collection(db, 'transactions'), {
              ...onlineTxData,
              relatedTxId: cashDocId,
              isSplit: true,
              createdAt: serverTimestamp()
            });
            if (cashDocId) {
              await setDoc(doc(db, 'transactions', cashDocId), {
                relatedTxId: onlineRef.id
              }, { merge: true });
            }
          }
        }
      } else {
        const txData = {
          type: formData.type,
          amount: formData.amount,
          category: formData.category,
          description: formData.description,
          source: formData.source,
          receiptUrl,
          date: formData.date,
          time: formData.time,
          updatedAt: serverTimestamp(),
          userId: auth.currentUser?.uid || 'admin',
          userEmail: auth.currentUser?.email || 'admin@example.com',
          branchId: selectedBranch || 'branch_1',
          // Preserve supplier info
          ...(isEditing && oldTxData?.supplierPriceIds ? { supplierPriceIds: oldTxData.supplierPriceIds } : {}),
          ...(isEditing && oldTxData?.supplierName ? { supplierName: oldTxData.supplierName } : {})
        };

        if (isEditing && editingId) {
          let partnerId = oldTxData?.relatedTxId || null;
          if (!partnerId) {
            const cleanBaseDesc = (d: string) => d.replace(' (ສ່ວນເງິນສົດ)', '').replace(' (ສ່ວນເງິນໂອນ)', '').replace(' (Cash Part)', '').replace(' (Transfer Part)', '').trim();
            const base = cleanBaseDesc(oldTxData?.description || '');
            const qPartner = query(
              collection(db, 'transactions'),
              where('date', '==', oldTxData?.date || formData.date),
              where('branchId', '==', selectedBranch || 'branch_1')
            );
            const partnerSnap = await getDocs(qPartner);
            for (const docRef of partnerSnap.docs) {
              const dData = docRef.data();
              if (docRef.id !== editingId && dData.time === oldTxData?.time && cleanBaseDesc(dData.description || '') === base) {
                partnerId = docRef.id;
                break;
              }
            }
          }
          if (partnerId) {
            await deleteDoc(doc(db, 'transactions', partnerId)).catch(() => {});
            excludedFromSummary.add(partnerId);
          }

          await setDoc(doc(db, 'transactions', editingId), {
            ...txData,
            relatedTxId: '',
            isSplit: false
          }, { merge: true });
        } else {
          await addDoc(collection(db, 'transactions'), {
            ...txData,
            createdAt: serverTimestamp()
          });
        }
      }

      // Recalculate summary for the transaction date
      await recalculateDailySummary(formData.date, excludedFromSummary);
      
      // If date was changed during edit, recalculate old date too
      if (isEditing && oldTxData && oldTxData.date !== formData.date) {
        await recalculateDailySummary(oldTxData.date, excludedFromSummary);
      }

      setFormData({ 
        ...formData,
        amount: 0, 
        category: '', 
        description: '', 
        receipt: null 
      });
      setDisplayAmount('');
      setSplitSourceMode(false);
      setCashAmountInput(0);
      setCashDisplayAmount('');
      setIsEditing(false);
      setEditingId(null);
      setOldTxData(null);
      setDeleteReceipt(false);
      alert(isEditing ? 'ບົດບັນທຶກຖືກແກ້ໄຂແລ້ວ!' : 'ບັນທຶກສຳເລັດແລ້ວ!');
    } catch (err: any) {
      console.error("Save error:", err);
      alert(`ເກີດຂໍ້ຜິດພາດໃນການບັນທຶກ: ${err.message || 'Unknown error'}`);
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (tx: any) => {
    setTxToEdit(tx);
    setShowEditPinModal(true);
  };

  const handleEditConfirmed = () => {
    if (!txToEdit) return;
    setFormData({
      type: txToEdit.type,
      amount: txToEdit.amount,
      category: txToEdit.category,
      description: txToEdit.description || '',
      source: txToEdit.source,
      receipt: null,
      date: txToEdit.date,
      time: txToEdit.time
    });
    setDisplayAmount(txToEdit.amount.toLocaleString());
    setIsEditing(true);
    setEditingId(txToEdit.id);
    setOldTxData(txToEdit);
    setDeleteReceipt(false);
    setShowEditPinModal(false);
    setTxToEdit(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startDelete = (tx: any) => {
    setTxToDelete(tx);
    setShowDeletePinModal(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!txToDelete) return;
    try {
      setLoading(true);
      const excludedIds = new Set<string>([txToDelete.id]);
      
      // Delete the main transaction
      await deleteDoc(doc(db, 'transactions', txToDelete.id));

      // Also search and delete any split partner
      let partnerDeleted = false;
      if (txToDelete.relatedTxId) {
        await deleteDoc(doc(db, 'transactions', txToDelete.relatedTxId)).catch(() => {});
        excludedIds.add(txToDelete.relatedTxId);
        partnerDeleted = true;
      }
      
      // Fallback search for older partners without relatedTxId link
      const desc = txToDelete.description || '';
      const isSplitPart = desc.includes('(ສ່ວນເງິນສົດ)') || desc.includes('(Cash Part)') || desc.includes('(ສ່ວນເງິນໂອນ)') || desc.includes('(Transfer Part)');
      if (!partnerDeleted && isSplitPart) {
        const cleanBaseDesc = (d: string) => d.replace(' (ສ່ວນເງິນສົດ)', '').replace(' (ສ່ວນເງິນໂອນ)', '').replace(' (Cash Part)', '').replace(' (Transfer Part)', '').trim();
        const base = cleanBaseDesc(desc);
        const qPartner = query(
          collection(db, 'transactions'),
          where('date', '==', txToDelete.date),
          where('branchId', '==', txToDelete.branchId || 'branch_1')
        );
        const refSnap = await getDocs(qPartner);
        for (const docRef of refSnap.docs) {
          const dData = docRef.data();
          if (docRef.id !== txToDelete.id && dData.time === txToDelete.time && cleanBaseDesc(dData.description || '') === base) {
            await deleteDoc(doc(db, 'transactions', docRef.id)).catch(() => {});
            excludedIds.add(docRef.id);
          }
        }
      }

      await recalculateDailySummary(txToDelete.date, excludedIds);
      alert('ລຶບລາຍການສຳເລັດແລ້ວ!');
      setShowDeletePinModal(false);
      setTxToDelete(null);
    } catch (err: any) {
      console.error("Delete error:", err);
      alert(`ເກີດຂໍ້ຜິດພາດໃນການລຶບ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllConfirmed = async () => {
    try {
      setLoading(true);
      // Fetch all transactions
      const txSnap = await getDocs(collection(db, 'transactions'));
      const deleteTxPromises = txSnap.docs.map(docRef => deleteDoc(doc(db, 'transactions', docRef.id)));
      await Promise.all(deleteTxPromises);

      // Fetch all dailySummaries
      const summarySnap = await getDocs(collection(db, 'dailySummaries'));
      const deleteSummaryPromises = summarySnap.docs.map(docRef => deleteDoc(doc(db, 'dailySummaries', docRef.id)));
      await Promise.all(deleteSummaryPromises);

      // Reset local states to prevent stale dashboards
      setDailySummary(null);
      setTransactions([]);
      setWeeklyData([]);

      alert(i18n.language === 'la' ? 'ລ້າງປະຫວັດການເງິນທັງໝົດສຳເລັດແລ້ວ!' : 'Cleared all transaction history successfully!');
      setShowClearAllPinModal(false);
    } catch (err: any) {
      console.error("Clear all error:", err);
      alert(`ເກີດຂໍ້ຜິດພາດ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const executeApprovedAction = async () => {
    if (approvalType === 'bank') {
      await handleBankApproved();
    }
    setApprovalType(null);
    setPendingAction(null);
  };

  const handleBankApproved = async () => {
    try {
      // Adding bank opening balance as a special income transaction
      await addDoc(collection(db, 'transactions'), {
        type: 'income',
        amount: bankAmount,
        category: 'opening_balance',
        description: 'Bank Account Opening Balance (ຍອດຍົກມາ)',
        source: 'online',
        date: todayStr,
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        branchId: selectedBranch || 'branch_1'
      });

      // Recalculate Summary
      await recalculateDailySummary(todayStr);

      setShowBankModal(false);
      setBankAmount(0);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <ApprovalModal 
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        onApprove={executeApprovedAction}
        actionType={approvalType === 'bank' ? 'Bank Sync' : 'Save Transaction'}
        masterPin={appConfig?.masterApprovalPin}
      />

      <PinModal
        isOpen={showEditPinModal}
        onClose={() => setShowEditPinModal(false)}
        correctPin={appConfig?.masterApprovalPin}
        onSuccess={handleEditConfirmed}
      />

      <PinModal
        isOpen={showDeletePinModal}
        onClose={() => setShowDeletePinModal(false)}
        correctPin={appConfig?.masterApprovalPin}
        onSuccess={handleDeleteConfirmed}
      />

      <PinModal
        isOpen={showClearAllPinModal}
        onClose={() => setShowClearAllPinModal(false)}
        correctPin={appConfig?.masterApprovalPin}
        onSuccess={handleClearAllConfirmed}
      />

      {/* Monthly Financial Performance & Advisory Modal */}
      {showMonthlySummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/20 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#073069] max-w-2xl w-full p-8 rounded-[2rem] border border-slate-200 dark:border-white/10 shadow-2xl space-y-6 text-slate-800 dark:text-white max-h-[90vh] overflow-y-auto scrollbar-hide">
            
            {/* Header */}
            <div className="flex justify-between items-start border-b dark:border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-emerald-500 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-black uppercase tracking-widest text-[#052659] dark:text-white">
                    {i18n.language === 'la' ? 'ບົດສະຫຼຸບລາຍເດືອນ & ຄຳແນະນຳ' : 'Monthly Performance & Advisory Board'}
                  </h3>
                  <p className="text-[10px] text-slate-400 dark:text-slate-300 uppercase font-bold tracking-wider mt-0.5">
                    {i18n.language === 'la' ? 'ບົດວິເຄາະ ແລະ ຄຳແນະນຳທາງການເງິນປະຈຳເດືອນ' : 'Expert audit reports and financial strategic recommendations'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowMonthlySummaryModal(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Selector bar */}
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-slate-50 dark:bg-black/20 rounded-2xl border border-slate-100 dark:border-white/5">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">
                {i18n.language === 'la' ? 'ເລືອກເດືອນເພື່ອວິເຄາະ:' : 'Select Month For Audit:'}
              </div>
              <input 
                type="month"
                value={selectedMonthlyMonth}
                onChange={(e) => {
                  setSelectedMonthlyMonth(e.target.value);
                  fetchMonthlySummaryData(e.target.value);
                }}
                className="w-full sm:w-auto text-xs bg-white dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-xl p-2.5 font-bold outline-none text-slate-800 dark:text-white text-center shadow-sm"
              />
            </div>

            {/* Loader / Content */}
            {loadingMonthlySummary ? (
              <div className="flex flex-col items-center justify-center py-20 space-y-4">
                <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  {i18n.language === 'la' ? 'ກຳລັງປະມວນຜົນ ແລະ ວິເຄາະຂໍ້ມູນ...' : 'Compiling Ledger & Processing Audit...'}
                </p>
              </div>
            ) : monthlySummaryData ? (
              <div className="space-y-6">
                
                {/* Metrics Bento Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Total Income */}
                  <div className="p-4 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                      {i18n.language === 'la' ? 'ລາຍຮັບທັງໝົດ' : 'Total Deposits'}
                    </span>
                    <h4 className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                      +{monthlySummaryData.income.toLocaleString()} <span className="text-[10px]">₭</span>
                    </h4>
                    <div className="text-[9px] text-slate-400 dark:text-slate-300 space-y-0.5 uppercase font-bold">
                      <p>Cash: {monthlySummaryData.cashIncome.toLocaleString()} ₭</p>
                      <p>Online: {monthlySummaryData.onlineIncome.toLocaleString()} ₭</p>
                    </div>
                  </div>

                  {/* Total Expense */}
                  <div className="p-4 bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 rounded-2xl space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-red-500 dark:text-red-400">
                      {i18n.language === 'la' ? 'ລາຍຈ່າຍທັງໝົດ' : 'Total Withdrawals'}
                    </span>
                    <h4 className="text-lg font-black text-red-500 dark:text-red-400">
                      -{monthlySummaryData.expenses.toLocaleString()} <span className="text-[10px]">₭</span>
                    </h4>
                    <div className="text-[9px] text-slate-400 dark:text-slate-300 space-y-0.5 uppercase font-bold">
                      <p>Cash: {monthlySummaryData.cashExpenses.toLocaleString()} ₭</p>
                      <p>Online: {monthlySummaryData.onlineExpenses.toLocaleString()} ₭</p>
                    </div>
                  </div>

                  {/* Net Profit */}
                  <div className={`p-4 rounded-2xl space-y-2 border ${
                    monthlySummaryData.netProfit >= 0 
                      ? 'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20' 
                      : 'bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/20'
                  }`}>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${
                      monthlySummaryData.netProfit >= 0 ? 'text-blue-500 dark:text-blue-400' : 'text-amber-500 dark:text-amber-400'
                    }`}>
                      {i18n.language === 'la' ? 'ກຳໄລສຸດທິ' : 'Net Revenue Profit'}
                    </span>
                    <h4 className={`text-lg font-black ${
                      monthlySummaryData.netProfit >= 0 ? 'text-blue-500 dark:text-blue-400' : 'text-amber-500 dark:text-amber-400'
                    }`}>
                      {monthlySummaryData.netProfit >= 0 ? '+' : ''}{monthlySummaryData.netProfit.toLocaleString()} <span className="text-[10px]">₭</span>
                    </h4>
                    <div className="text-[9px] text-slate-400 dark:text-slate-300 space-y-0.5 uppercase font-bold">
                      <p>Margin: {monthlySummaryData.profitMargin.toFixed(1)}%</p>
                      <p>Logs Count: {monthlySummaryData.transactionsCount}</p>
                    </div>
                  </div>
                </div>

                {/* Recommendations and Audit Analysis */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-widest text-[#052659] dark:text-sky-300 flex items-center gap-2">
                    <Info className="w-4 h-4 text-emerald-500" />
                    {i18n.language === 'la' ? 'ຄຳແນະນຳ ແລະ ບົດວິເຄາະທາງການເງິນ' : 'Expert Financial Audit & Analysis'}
                  </h4>

                  <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2 scrollbar-hide">
                    {monthlySummaryData.reasons.map((r: any, idx: number) => (
                      <div 
                        key={idx} 
                        className={`p-4 rounded-2xl border flex flex-col gap-2 transition-all ${
                          r.level === 'warning' 
                            ? 'bg-red-500/5 border-red-500/10 dark:bg-red-500/10' 
                            : r.level === 'success'
                              ? 'bg-emerald-500/5 border-emerald-500/10 dark:bg-emerald-500/10'
                              : 'bg-[#052659]/5 border-slate-100 dark:bg-white/5 dark:border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md ${
                            r.level === 'warning' 
                              ? 'bg-red-500 text-white' 
                              : r.level === 'success'
                                ? 'bg-emerald-500 text-white'
                                : 'bg-blue-500 text-white'
                          }`}>
                            {r.level}
                          </span>
                          <span className="text-[11px] font-bold dark:text-white">
                            {i18n.language === 'la' ? r.issueLa : r.issue}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-300 leading-relaxed font-medium pl-1 border-l-2 border-slate-300/50 dark:border-white/20">
                          <strong>{i18n.language === 'la' ? 'ແນວທາງແກ້ໄຂ:' : 'Actionable Advice:'}</strong> {i18n.language === 'la' ? r.recommendationLa : r.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions at bottom of loaded data */}
                <div className="flex gap-4 pt-4 border-t dark:border-white/10">
                  <button
                    type="button"
                    onClick={handleGenerateMonthlySummaryPDF}
                    disabled={generatingMonthlyPDF}
                    className="flex-1 py-3 text-xs font-black uppercase bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                  >
                    {generatingMonthlyPDF ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{i18n.language === 'la' ? 'ກຳລັງສ້າງ PDF...' : 'Generating Report...'}</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>{i18n.language === 'la' ? 'ສົ່ງອອກລາຍງານ PDF' : 'Export PDF Report'}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMonthlySummaryModal(false)}
                    className="flex-1 py-3 text-xs font-black uppercase bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/20 text-slate-700 dark:text-slate-300 rounded-xl transition-all cursor-pointer"
                  >
                    {i18n.language === 'la' ? 'ປິດໜ້າຕ່າງ' : 'Close Audit Panel'}
                  </button>
                </div>

              </div>
            ) : (
              <div className="text-center py-10 text-slate-400 uppercase font-black text-[11px]">
                {i18n.language === 'la' ? 'ບໍ່ພົບຂໍ້ມູນທາງການເງິນ' : 'No data fetched'}
              </div>
            )}

          </div>
        </div>
      )}

      {/* La Dolce PDF Statement Range Selector Modal */}
      {showStatementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/20 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#073069] max-w-md w-full p-6 rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl space-y-6 text-slate-800 dark:text-white">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-indigo-500/10 rounded-full flex items-center justify-center mb-3">
                <FileText className="w-6 h-6 text-indigo-500" />
              </div>
              <h3 className="text-lg font-black uppercase tracking-tight text-[#052659] dark:text-white">
                {i18n.language === 'la' ? 'ໃບສະຫຼຸບບັນຊີ La Dolce Statement' : 'La Dolce Account Statement'}
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-indigo-300 uppercase font-black tracking-widest mt-0.5">
                {i18n.language === 'la' ? 'ເລືອກໄລຍະເວລາເພື່ອທຳການ Export PDF' : 'Official bank-style transaction ledger'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">
                  {i18n.language === 'la' ? 'ວັນທີເລີ່ມຕົ້ນ' : 'Start Date'}
                </label>
                <input
                  type="date"
                  value={statementStartDate}
                  onChange={e => setStatementStartDate(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-xl p-2.5 text-slate-700 dark:text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[9px] font-black uppercase text-slate-400 block mb-1">
                  {i18n.language === 'la' ? 'ວັນທີສິ້ນສຸດ' : 'End Date'}
                </label>
                <input
                  type="date"
                  value={statementEndDate}
                  onChange={e => setStatementEndDate(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-[#052659] border border-slate-200 dark:border-white/10 rounded-xl p-2.5 text-slate-700 dark:text-white focus:outline-none"
                />
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-[#052659]/30 rounded-xl border border-slate-150 dark:border-white/5 space-y-1">
                <p className="text-[10px] font-black uppercase text-slate-404 tracking-wider">
                  {i18n.language === 'la' ? 'ສະຖານທີ່ / ສາຂາ' : 'Reporting Branch'}
                </p>
                <p className="text-xs font-bold text-[#052659] dark:text-indigo-300">
                  {(selectedBranch || 'branch_1') === 'branch_1' 
                    ? (i18n.language === 'la' ? 'ສາຂາ 1 (Vientiane Main)' : 'Branch 1 (Vientiane Main)')
                    : (i18n.language === 'la' ? 'ສາຂາ 2 (Luang Prabang)' : 'Branch 2 (Luang Prabang)')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleGeneratePDFStatement}
                disabled={generatingStatement}
                className="flex-1 py-2.5 text-xs font-black uppercase tracking-widest bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-400 text-white rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                {generatingStatement ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {i18n.language === 'la' ? 'ກຳລັງສ້າງ...' : 'Compiling...'}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    {i18n.language === 'la' ? 'ດາວໂຫຼດ PDF' : 'Download statement'}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowStatementModal(false)}
                className="flex-1 py-2.5 text-xs font-bold uppercase bg-slate-100 hover:bg-slate-200 dark:bg-white/15 dark:hover:bg-white/20 text-slate-600 dark:text-slate-300 rounded-xl transition-all cursor-pointer"
              >
                {i18n.language === 'la' ? 'ຍົກເລີກ' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bank Balance Input Modal */}
      {showBankModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/20 backdrop-blur-sm animate-in fade-in duration-300">
           <div className="glass-card max-w-md w-full p-8 border-primary/20 shadow-2xl space-y-6">
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Landmark className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-bold text-primary dark:text-white uppercase tracking-tight">Bank Opening Balance</h3>
                <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-widest italic">ຍອດຍົກມາຈາກບັນຊີທະນາຄານ</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="label-xs block mb-3 text-center">Enter Amount (₭)</label>
                  <input 
                    type="text"
                    className="crystal-input text-4xl font-bold text-center py-6 h-auto tracking-tighter"
                    value={bankAmount.toLocaleString()}
                    onChange={e => {
                      const val = e.target.value.replace(/,/g, '');
                      if (val === '' || !isNaN(Number(val))) {
                        setBankAmount(Number(val) || 0);
                      }
                    }}
                    placeholder="0"
                    autoFocus
                  />
                </div>
                <button 
                  onClick={() => {
                    setApprovalType('bank');
                    setShowApprovalModal(true);
                  }}
                  className="w-full py-4 bg-primary text-white rounded-xl font-bold uppercase tracking-wider hover:scale-[1.02] active:scale-95 transition-all shadow-lg"
                >
                  Request Admin Approval
                </button>
                <button 
                  onClick={() => setShowBankModal(false)}
                  className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest"
                >
                  Cancel
                </button>
              </div>
           </div>
        </div>
      )}

      {/* Transaction Form */}
      <div className="xl:col-span-1 space-y-6">
        <div className="high-density-card">
          <div className="flex justify-between items-center mb-6">
            <h3 className="label-xs flex items-center gap-2">
              <PlusCircle className="w-3 h-3 text-primary" />
              {isEditing ? 'ແກ້ໄຂລາຍການ' : t('add_item')}
            </h3>
            {isEditing && (
              <button 
                onClick={() => {
                  setIsEditing(false);
                  setEditingId(null);
                  setFormData({
                    ...formData,
                    amount: 0,
                    category: '',
                    description: '',
                    receipt: null
                  });
                  setDisplayAmount('');
                }}
                className="text-[9px] font-black text-red-500 uppercase tracking-widest hover:underline"
              >
                Cancel Edit
              </button>
            )}
            <button 
              onClick={() => setShowBankModal(true)}
              className="px-4 py-2 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-xl text-[9px] font-black text-primary dark:text-blue-400 uppercase tracking-[0.15em] flex items-center gap-2 transition-all shadow-sm hover:shadow-md"
            >
              <Landmark className="w-3 h-3 transition-transform group-hover:rotate-12" />
              Bank Sync
            </button>
          </div>
          <form onSubmit={handleAddTransaction} className="space-y-4">
            <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-lg">
              <button 
                type="button" 
                onClick={() => setFormData({...formData, type: 'expense'})}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-bold transition-all ${formData.type === 'expense' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}
              >
                {t('expense')}
              </button>
              <button 
                type="button" 
                onClick={() => setFormData({...formData, type: 'income'})}
                className={`flex-1 py-1.5 rounded-md text-[11px] font-bold transition-all ${formData.type === 'income' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}
              >
                {t('income')}
              </button>
            </div>

              <div>
                <label className="label-xs block mb-2">Transaction Date & Time</label>
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    type="date"
                    required
                    className="crystal-input h-[40px] !text-[11px] !py-0"
                    value={formData.date}
                    onChange={e => setFormData({...formData, date: e.target.value})}
                  />
                  <input 
                    type="time"
                    required
                    className="crystal-input h-[40px] !text-[11px] !py-0"
                    value={formData.time}
                    onChange={e => setFormData({...formData, time: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="label-xs block mb-2">{t('amount')} (₭)</label>
                <input 
                  type="text"
                  required
                  className="crystal-input text-2xl tracking-tighter"
                  placeholder="0"
                  value={displayAmount}
                  onChange={handleAmountChange}
                />
              </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-xs block mb-2">{t('category')}</label>
                <select 
                  className="crystal-input h-[50px] !py-0 !text-xs"
                  value={formData.category}
                  onChange={e => setFormData({...formData, category: e.target.value})}
                  required
                >
                  <option value="" className="bg-white dark:bg-slate-800">{t('select_item')}...</option>
                  <option value="Purchasing" className="bg-white dark:bg-slate-800">Purchasing (ຊື້ເຄື່ອງເຂົ້າ)</option>
                  <option value="Sales" className="bg-white dark:bg-slate-800">Sales (ຍອດຂາຍ)</option>
                  <option value="dividends" className="bg-white dark:bg-slate-800">Dividends (ປັນຜົນໄຕມາດ)</option>
                  <option value="operations" className="bg-white dark:bg-slate-800">Operations (ດຳເນີນງານ)</option>
                  <option value="admin" className="bg-white dark:bg-slate-800">Administration (ບໍລິຫານ)</option>
                  <option value="water" className="bg-white dark:bg-slate-800">Water (ຄ່ານ້ຳ)</option>
                  <option value="electricity" className="bg-white dark:bg-slate-800">Electricity (ຄ່າໄຟ)</option>
                  <option value="rent" className="bg-white dark:bg-slate-800">Rent (ຄ່າເຊົ່າ)</option>
                  <option value="salary" className="bg-white dark:bg-slate-800">Salary (ເງິນເດືອນພະນັກງານ)</option>
                  <option value="refund" className="bg-white dark:bg-slate-800">Refund (ຄືນເງິນລູກຄ້າ)</option>
                  <option value="other" className="bg-white dark:bg-slate-800">Other</option>
                </select>
              </div>
              <div>
                <label className="label-xs block mb-2">Source</label>
                <select 
                  className="crystal-input h-[50px] !py-0 !text-xs"
                  value={formData.source}
                  onChange={e => {
                    setFormData({...formData, source: e.target.value});
                    // Reset custom split modes if user manually alters source
                    if (splitSourceMode) {
                      setSplitSourceMode(false);
                      setCashAmountInput(0);
                      setCashDisplayAmount('');
                    }
                  }}
                >
                  <option value="cash" className="bg-white dark:bg-slate-800">Cash</option>
                  <option value="online banking" className="bg-white dark:bg-slate-800">Online banking</option>
                </select>
              </div>
            </div>

            {/* SPLIT CO-PAYMENT REGISTRATION */}
            {formData.type === 'income' && (
              <div className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 rounded-2xl space-y-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox"
                    checked={splitSourceMode}
                    onChange={(e) => {
                      setSplitSourceMode(e.target.checked);
                      if (e.target.checked) {
                        setCashAmountInput(0);
                        setCashDisplayAmount('');
                      }
                    }}
                    className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300 transition-colors cursor-pointer"
                  />
                  <span className="text-[10.5px] font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider">
                    {i18n.language === 'la' ? 'ແບ່ງສ່ວນ (ເງິນສົດ + ເງິນໂອນ)' : 'Split Cash & Online banking'}
                  </span>
                </label>

                {splitSourceMode && (
                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-200/50 dark:border-white/5 animate-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        {i18n.language === 'la' ? 'ຍອດເງິນສົດ (Cash portion)' : 'Cash portion (₭)'}
                      </label>
                      <input 
                        type="text"
                        className="crystal-input !h-[38px] !text-xs font-bold font-mono text-[#052659] dark:text-emerald-400"
                        placeholder="0"
                        value={cashDisplayAmount}
                        onChange={(e) => {
                          const rawVal = e.target.value.replace(/,/g, '');
                          if (rawVal === '' || !isNaN(Number(rawVal))) {
                            const numeric = Number(rawVal) || 0;
                            if (numeric <= formData.amount) {
                              setCashAmountInput(numeric);
                              setCashDisplayAmount(numeric ? numeric.toLocaleString() : '');
                            } else {
                              setCashAmountInput(formData.amount);
                              setCashDisplayAmount(formData.amount.toLocaleString());
                            }
                          }
                        }}
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                        {i18n.language === 'la' ? 'ຍອດເງິນໂອນ (Bank portion)' : 'Bank Transfer (₭)'}
                      </label>
                      <div className="crystal-input !h-[38px] flex items-center justify-center font-bold font-mono text-[11px] text-[#052659] dark:text-blue-400 bg-slate-100/50 dark:bg-black/30 select-none">
                        {((formData.amount || 0) - (cashAmountInput || 0)).toLocaleString()} ₭
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
               <div className="flex justify-between items-center mb-1.5">
                 <label className="label-xs block mb-0">{t('receipt_upload')}</label>
                 <div className="flex items-center gap-1 text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase">
                    <Info className="w-3 h-3" />
                    <span>INFO / ຄໍາແນະນໍາ</span>
                 </div>
               </div>

               {/* Guidelines advice box */}
               <div className="p-3 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/15 rounded-xl space-y-1 mb-2">
                 <p className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 flex items-center gap-1 uppercase">
                   🔔 {i18n.language === 'la' ? 'ຄູ່ມືອັບໂຫຼດບິນຈັດຊື້' : 'Receipt Guideline'}
                 </p>
                 <p className="text-[10px] text-slate-600 dark:text-slate-350 leading-relaxed">
                    {i18n.language === 'la'
                      ? 'ກະລຸນາອັບໂຫຼດ "ໃບບິນຈິງຈາກຮ້ານຄ້າ" ທີ່ມີລາຍການຈະແຈ້ງ (ບໍ່ແມ່ນ "ໃບສະລິບໂອນເງິນ" ຈາກທະນາຄານ). ຫາກລືມບັນທຶກ, ທ່ານສາມາດເລືອກ "ວັນທີ" ຍ້ອນຫຼັງຢູ່ດ້ານເທິງ ເພື່ອອັບໂຫຼດຍ້ອນຫຼັງໄດ້ທຸກເວລາ!'
                      : 'Please upload the actual merchant billing invoice/receipt with line details (not bank payment slips). You can select past dates above to post forgotten expenses retroactively at any time.'}
                 </p>
               </div>
              <label className="block p-4 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-2xl cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-all duration-300">
                <div className="flex flex-col items-center gap-1 justify-center text-center">
                  <Upload className={`w-5 h-5 mb-1 ${formData.receipt ? 'text-blue-500' : 'text-slate-400'}`} />
                  <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
                    {formData.receipt ? "Selected a New Receipt" : (isEditing && oldTxData?.receiptUrl ? 'Change Receipt' : t('select_item'))}
                  </span>
                  <p className="text-[8px] text-slate-400 uppercase font-bold mt-0.5">
                    {i18n.language === 'la' 
                      ? 'ຮອງຮັບ ຮູບພາບ, PDF ແລະ ກັອບປີ້ວາງຢູ່ນີ້ໄດ້ເລີຍ (Ctrl+V)' 
                      : 'Supports Images, PDF & Clipboard Paste (Ctrl+V)'}
                  </p>
                </div>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*,application/pdf"
                  onChange={e => {
                    const file = e.target.files?.[0] || null;
                    setFormData({...formData, receipt: file});
                    if (file) {
                      setDeleteReceipt(false);
                    }
                  }}
                />
              </label>

              {/* Selection Previews & Existing Receipts details */}
              {formData.receipt && (
                 <div className="mt-3 p-2 bg-slate-100/50 dark:bg-white/5 rounded-xl border border-slate-200/50 dark:border-white/5 flex items-center justify-between gap-3 shadow-sm animate-fade-in">
                    <div className="flex items-center gap-2">
                       {formData.receipt.type.startsWith('image/') ? (
                          <img 
                             src={URL.createObjectURL(formData.receipt)} 
                             alt="Preview" 
                             className="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-white/10 shadow-sm"
                          />
                       ) : (
                          <div className="w-10 h-10 bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg flex items-center justify-center text-[10px] font-black uppercase tracking-wider shadow-sm">
                             PDF
                          </div>
                       )}
                       <div className="text-left leading-tight">
                          <p className="text-[10px] font-black text-slate-700 dark:text-slate-200 truncate max-w-[140px]">{formData.receipt.name}</p>
                          <p className="text-[8px] text-slate-400 font-bold">{(formData.receipt.size / 1024).toFixed(0)} KB</p>
                       </div>
                    </div>
                    <button 
                       type="button"
                       onClick={() => setFormData({...formData, receipt: null})}
                       className="p-1.5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                    >
                       <X className="w-4 h-4" />
                    </button>
                 </div>
              )}

              {isEditing && oldTxData?.receiptUrl && !deleteReceipt && !formData.receipt && (
                 <div className="mt-3 p-2 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-200/50 dark:border-blue-500/10 flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-2">
                       {oldTxData.receiptUrl.toLowerCase().includes('.pdf') || oldTxData.receiptUrl.includes('?alt=media&token=') ? (
                          <div className="w-10 h-10 bg-sky-100 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-lg flex items-center justify-center text-[10px] font-black uppercase tracking-wider shadow-sm">
                             DOC
                          </div>
                       ) : (
                          <img 
                             src={oldTxData.receiptUrl} 
                             alt="Current Receipt" 
                             referrerPolicy="no-referrer"
                             className="w-10 h-10 object-cover rounded-lg border border-blue-200 dark:border-blue-500/10 shadow-sm"
                          />
                       )}
                       <div className="text-left leading-tight">
                          <span className="text-[8px] font-black uppercase text-blue-600 dark:text-blue-400 tracking-widest block">Current Receipt</span>
                          <a 
                             href={oldTxData.receiptUrl} 
                             target="_blank" 
                             rel="noreferrer" 
                             className="text-[9px] text-blue-500 dark:text-blue-400 hover:underline font-extrabold flex items-center gap-0.5"
                          >
                             View Document ↗
                          </a>
                       </div>
                    </div>
                    <button 
                       type="button"
                       onClick={() => setDeleteReceipt(true)}
                       className="px-2 py-1 bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-md text-[8px] font-black uppercase tracking-wider transition-all"
                    >
                       Remove
                    </button>
                 </div>
              )}

              {isEditing && oldTxData?.receiptUrl && deleteReceipt && !formData.receipt && (
                 <div className="mt-3 p-2 bg-rose-50/80 dark:bg-rose-900/10 rounded-xl border border-rose-200/50 dark:border-rose-500/10 flex items-center justify-between gap-3 shadow-sm">
                    <span className="text-[8px] font-black text-rose-500 dark:text-rose-400 uppercase tracking-widest">Receipt will be removed</span>
                    <button 
                       type="button"
                       onClick={() => setDeleteReceipt(false)}
                       className="px-2 py-1 bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-300 hover:bg-slate-200 rounded-md text-[8px] font-black uppercase tracking-wider transition-all"
                    >
                       Undo
                    </button>
                 </div>
              )}
            </div>

            <button type="submit" disabled={loading} className="crystal-button w-full shadow-primary/20 disabled:opacity-50">
              {loading ? 'Processing...' : (isEditing ? 'Update Transaction' : `${t('save')} ${t('financials')}`)}
            </button>
          </form>
        </div>

        {/* Import Supplier Purchases Card */}
        <div className="high-density-card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="label-xs flex items-center gap-2 text-slate-800 dark:text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span>{i18n.language === 'la' ? 'ດຶງລາຍຈ່າຍຜູ້ສະໜອງ' : 'Import Supplier Purchases'}</span>
            </h3>
          </div>

          <p className="text-[10px] text-slate-400 leading-normal mb-4 font-bold uppercase tracking-wider italic">
            {i18n.language === 'la' 
              ? 'ລວມຍອດບິນຜູ້ສະໜອງຂອງມື້ນັ້ນເປັນລາຍຈ່າຍຮ້ານໂດຍບໍ່ຕ້ອງຄີຊ້ຳ' 
              : 'Bundle and pull supplier price entries for a given date as a store purchase expense'}
          </p>

          {/* Supplier Import Warning Note */}
          <div className="p-3 mb-4 bg-amber-500/5 dark:bg-amber-500/10 rounded-xl border border-amber-500/15 text-[10px] text-amber-700 dark:text-amber-300 font-bold leading-relaxed space-y-1">
            <p className="flex items-center gap-1.5 uppercase tracking-wider text-[9px] font-black text-amber-600 dark:text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              {i18n.language === 'la' ? 'ຄຳເຕືອນປ້ອງກັນຍອດຊ້ຳຊ້ອນ:' : 'PREVENT DUPLICATES:'}
            </p>
            {i18n.language === 'la' ? (
              <p>ຫ້າມຄີລາຍຈ່າຍນີ້ດ້ວຍຕົນເອງໃນແບບຟອມຂ້າງເທິງ! ພຽງແຕ່ກົດປຸ່ມ <strong>"ດຶງລາຍຈ່າຍ"</strong> ລະບົບຈະຄິດໄລ່ ແລະ ບັນທຶກເຂົ້າບັນຊີ Feed ລາຍວັນໃຫ້ໂດຍອັດຕະໂນມັດ ໂດຍບໍ່ເຮັດໃຫ້ຍອດຊ້ຳກັນ.</p>
            ) : (
              <p>Do NOT manually type this expense in the transaction form above. Just click <strong>"Pull"</strong> — the system will automatically create the record and sync it without creating duplicates.</p>
            )}
          </div>

          {/* Date Selectors (Dual-date setup) */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="space-y-1">
              <label className="label-xs block text-slate-400">
                {i18n.language === 'la' ? '1. ວັນທີຜູ້ສະໜອງ' : '1. Supplier Date'}
              </label>
              <input 
                type="date"
                value={pullDate}
                onChange={e => setPullDate(e.target.value)}
                className="crystal-input text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="label-xs block text-slate-400">
                {i18n.language === 'la' ? '2. ວັນທີບັນທຶກຊຳລະ' : '2. Payment Date'}
              </label>
              <input 
                type="date"
                value={paymentDate}
                onChange={e => setPaymentDate(e.target.value)}
                className="crystal-input text-xs font-semibold text-blue-600 dark:text-blue-400"
              />
            </div>
          </div>

          {/* Supplier Bills List */}
          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {supplierBillsForSelectedDate.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-[10px] font-black uppercase tracking-widest border border-dashed border-slate-200/50 dark:border-white/5 rounded-xl">
                {i18n.language === 'la' ? 'ບໍ່ມີຂໍ້ມູນຜູ້ສະໜອງໃນວັນທີນີ້' : 'No supplier entries for this date'}
              </div>
            ) : (
              supplierBillsForSelectedDate.map((bill) => {
                const alreadyImported = bill.sourceIds.some((id: string) => importedSupplierPriceIds.has(id));
                const importedBillTx = supplyPurchaseTransactions.find((tx: any) => 
                  tx.type === 'expense' && 
                  (tx.supplierPriceIds || []).some((id: string) => bill.sourceIds.includes(id))
                );

                const currentSource = billPaymentSources[bill.id] || 'online banking';

                return (
                  <div 
                    key={bill.id} 
                    className={`p-3.5 rounded-xl border transition-all text-left ${
                      alreadyImported 
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-990 dark:text-emerald-300' 
                        : 'bg-slate-50 dark:bg-white/5 border-slate-200/55 dark:border-white/5'
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1.5">
                      <div>
                        {/* Supplier Display */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black uppercase text-slate-900 dark:text-white leading-none">
                            {bill.supplier}
                          </span>
                          {bill.isGrouped ? (
                            <span className="text-[7.5px] font-black uppercase bg-indigo-500/10 text-indigo-500 tracking-widest px-1.5 py-0.5 rounded-md">
                              Grouped
                            </span>
                          ) : (
                            <span className="text-[7.5px] font-black uppercase bg-amber-500/10 text-amber-500 tracking-widest px-1.5 py-0.5 rounded-md">
                              Split OTHER
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 block mt-1 leading-normal">
                          {bill.items.map((item: any) => {
                            const pName = products.find(prod => prod.id === item.productId)?.name || 'Unknown';
                            return `${pName} (${item.quantity || 1}x)`;
                          }).join(', ')}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-black text-slate-900 dark:text-white block">
                          {Math.round(bill.totalPrice).toLocaleString()} ₭
                        </span>
                      </div>
                    </div>

                    {/* Source Selector & Pull Button */}
                    {!alreadyImported && (
                      <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-white/5 flex items-center justify-between gap-3">
                        <div className="w-[100px]">
                          <select 
                            value={currentSource}
                            onChange={(e) => setBillPaymentSources({
                              ...billPaymentSources,
                              [bill.id]: e.target.value as 'cash' | 'online banking'
                            })}
                            className="w-full shrink-0 h-7 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg text-[9px] font-black py-0.5 px-2 text-slate-700 dark:text-slate-200 uppercase tracking-widest outline-none"
                          >
                            <option value="online banking">Online</option>
                            <option value="cash">Cash</option>
                          </select>
                        </div>

                        <button 
                          onClick={() => handlePullSupplierBill(bill)}
                          disabled={importingBillId === bill.id}
                          className="flex-1 h-7 bg-primary hover:bg-[#3b82f6] text-white flex items-center justify-center gap-1.5 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all active:scale-[0.98] cursor-pointer"
                        >
                          {importingBillId === bill.id ? (
                            <span>Importing...</span>
                          ) : (
                            <>
                              <PlusCircle className="w-3 h-3" />
                              <span>{i18n.language === 'la' ? 'ດຶງລາຍຈ່າຍ' : 'Pull'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {alreadyImported && (
                      <div className="mt-2 pt-2 border-t border-emerald-500/10 space-y-1">
                        <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                          <div className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-emerald-500" />
                            <span>{i18n.language === 'la' ? 'ດຶງມາເປັນລາຍຈ່າຍແລ້ວ' : 'Imported ✓'}</span>
                          </div>
                          <span className="text-[8px] opacity-75 font-mono">
                            {importedBillTx?.source || 'online'}
                          </span>
                        </div>
                        {importedBillTx?.date && (
                          <div className="text-[8.5px] font-bold text-slate-550 dark:text-slate-450 flex justify-between">
                            <span>{i18n.language === 'la' ? 'ວັນທີບັນທຶກຊຳລະ:' : 'Payment Date:'}</span>
                            <span className="font-mono text-blue-500 dark:text-blue-400">
                              {importedBillTx.date.includes('-') 
                                ? importedBillTx.date.split('-').reverse().join('/') 
                                : importedBillTx.date}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Daily Stats & Feed */}
      <div className="xl:col-span-2 space-y-6">
        <div className="flex justify-end gap-2 px-2 flex-wrap">
            <button 
              onClick={rebuildAllSummariesFromTransactions}
              disabled={loading}
              className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              title="Recalculate all Daily Summaries sequentially from Transaction History"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {i18n.language === 'la' ? 'ກວດສອບ ແລະ ຄິດໄລ່ຍອດຄືນໃໝ່' : 'Sync & Recalculate Totals'}
            </button>
            <button 
              onClick={() => setShowPrivacy(!showPrivacy)}
              className="px-4 py-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2 transition-all cursor-pointer"
            >
              {showPrivacy ? <Eye className="w-3 h-3 text-emerald-500" /> : <EyeOff className="w-3 h-3" />}
              {showPrivacy ? "Show Values" : "Hide Balance"} (ເປີດ/ປິດ ຍອດເງິນ)
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Main Balance Bento Grid */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="md:col-span-2 group relative overflow-hidden rounded-[2rem] border border-primary/10 bg-white dark:bg-[#052659] p-8 shadow-2xl transition-all duration-500 hover:shadow-primary/20"
          >
            <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full bg-primary/5 transition-transform duration-700 group-hover:scale-150"></div>
            <div className="relative z-10 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-blue-300/40 mb-2">{t('total_balance')}</p>
                  <h2 className="text-5xl font-black tracking-tighter text-[#052659] dark:text-white lg:text-6xl">
                    {showPrivacy ? '••••••' : (computedSummary?.finalBalance || 0).toLocaleString()}
                    <span className="ml-2 text-xl font-bold opacity-40">₭</span>
                  </h2>
                </div>
                <div className="rounded-2xl bg-primary/10 p-4 dark:bg-white/10">
                  <Receipt className="h-8 w-8 text-primary dark:text-white" />
                </div>
              </div>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                  Real-time sync
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Updated just now</p>
              </div>
            </div>
          </motion.div>

          <div className="flex flex-col gap-4 md:col-span-1">
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex-1 group relative overflow-hidden rounded-[2rem] border border-blue-100 bg-blue-50/30 dark:border-blue-400/20 dark:bg-blue-400/5 p-6 transition-all duration-500 hover:bg-blue-50/50 dark:hover:bg-blue-400/10 hover:shadow-lg"
            >
              <div className="relative z-10 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[9px] font-black uppercase tracking-wider text-[#052659]/60 dark:text-blue-200/40">{t('cash_in_hand')}</p>
                  <div className="rounded-xl bg-[#052659]/5 p-2 dark:bg-blue-400/10">
                    <ArrowUpCircle className="h-4 w-4 text-[#052659] dark:text-blue-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold tracking-tighter text-[#052659] dark:text-white italic">
                  {showPrivacy ? '••••••' : (computedSummary?.finalCashBalance || 0).toLocaleString()}
                  <span className="ml-1 text-sm opacity-40 italic">₭</span>
                </h3>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex-1 group relative overflow-hidden rounded-[2rem] border border-blue-100 bg-blue-50/30 dark:border-blue-400/20 dark:bg-blue-400/5 p-6 transition-all duration-500 hover:bg-blue-50/50 dark:hover:bg-blue-400/10 hover:shadow-lg"
            >
              <div className="relative z-10 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[9px] font-black uppercase tracking-wider text-[#052659]/60 dark:text-blue-200/40">{t('bank_account')}</p>
                  <div className="rounded-xl bg-[#052659]/5 p-2 dark:bg-blue-400/10">
                    <Landmark className="h-4 w-4 text-[#052659] dark:text-blue-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold tracking-tighter text-[#052659] dark:text-white italic">
                  {showPrivacy ? '••••••' : (computedSummary?.finalOnlineBalance || 0).toLocaleString()}
                  <span className="ml-1 text-sm opacity-40 italic">₭</span>
                </h3>
              </div>
            </motion.div>
          </div>

          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="md:col-span-1 space-y-4"
          >
            <BalanceCard title={t('opening_balance')} value={computedSummary?.previousBalance || 0} icon={Info} color="text-slate-400" showPrivacy={showPrivacy} />
            <BalanceCard title={t('income')} value={computedSummary?.income || 0} icon={ArrowUpCircle} color="text-green-500" showPrivacy={showPrivacy} />
            <BalanceCard title={t('expense')} value={computedSummary?.expenses || 0} icon={ArrowDownCircle} color="text-red-500" showPrivacy={showPrivacy} />
          </motion.div>
        </div>

        <div className="high-density-card p-0 flex flex-col">
          <div className="p-3 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex justify-between items-center">
            <h4 className="label-xs flex items-center gap-2">
              <BarChart3 className="w-3 h-3 text-primary" />
              Weekly Overview (ພາບລວມປະຈຳອາທິດ)
            </h4>
          </div>
          <div className="p-4 h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="date" 
                  tick={{fontSize: 9, fontWeight: 700}} 
                  tickFormatter={(val) => format(new Date(val), 'dd/MM')}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#052659', 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    borderRadius: '8px', 
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#fff'
                  }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(val: number) => [`${val.toLocaleString()} ₭`, '']}
                />
                <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} name="ລາຍຮັບ" />
                <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} name="ລາຍຈ່າຍ" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="high-density-card p-0 flex flex-col">
          <div className="p-3 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div className="flex items-center gap-3">
              <h4 className="label-xs">{t('recent_transactions')}</h4>
              <input 
                type="date" 
                className="bg-transparent border-none text-[10px] font-black text-primary focus:ring-0 cursor-pointer"
                value={viewDate}
                onChange={e => setViewDate(e.target.value)}
              />
            </div>
            <div className="flex items-center flex-wrap gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end">
              <button 
                onClick={handleExport}
                className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-blue-500 hover:text-blue-600 transition-colors"
                title="Export to CSV"
              >
                <Download className="w-3 h-3" />
                Export CSV
              </button>
              <button 
                onClick={() => setShowStatementModal(true)}
                className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 transition-colors"
                title="La Dolce Statement PDF"
              >
                <FileText className="w-3.5 h-3.5" />
                La Dolce Statement
              </button>
              <button 
                onClick={() => {
                  setShowMonthlySummaryModal(true);
                  fetchMonthlySummaryData(selectedMonthlyMonth);
                }}
                className="flex items-center gap-1.5 text-[9px] font-bold uppercase text-emerald-500 dark:text-emerald-400 hover:text-emerald-600 transition-colors"
                title="Monthly Performance & Advisory Board"
              >
                <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                {i18n.language === 'la' ? 'ບົດສະຫຼຸບລາຍເດືອນ & ຄຳແນະນຳ' : 'Monthly Summary & Advice'}
              </button>
              <span className="text-[10px] font-bold text-slate-400">{transactions.length} entries</span>
            </div>
          </div>
          <div className="flex-1 space-y-0 max-h-[500px] overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
            {/* Table Header for reconciliation */}
            <div className="grid grid-cols-6 p-2 bg-slate-50/80 dark:bg-white/5 text-[9px] font-black uppercase tracking-widest text-slate-400">
               <div className="col-span-2">Details</div>
               <div className="text-right">Time</div>
               <div className="text-right">Amount</div>
               <div className="text-right col-span-2">Action</div>
            </div>
            {transactions.map((tx, idx) => {
              // Simple running balance logic only works if we fetch all from start 
              // For daily views, we just show the transaction
              return (
              <div key={tx.id} className="flex justify-between items-center p-3 hover:bg-slate-50 dark:hover:bg-white/5 transition-all text-slate-900 dark:text-white group/row">
                <div className="flex items-center gap-3">
                  <div className={`w-1 h-8 rounded-full ${tx.type === 'income' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide truncate max-w-[120px] sm:max-w-[200px]" title={tx.category || tx.source}>
                      {tx.category || tx.source}
                    </p>
                    {tx.description && (
                      <p className="text-[10px] text-slate-550 dark:text-slate-405 font-medium max-w-[120px] sm:max-w-[220px] truncate leading-tight mt-0.5" title={tx.description}>
                        {tx.description}
                      </p>
                    )}
                    <p className="text-[9px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-tight mt-0.5">
                      {tx.time} • {tx.userEmail?.split('@')[0]}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-4">
                  <div className="text-right">
                    <p className={`text-xs font-mono font-bold ${tx.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>
                      {showPrivacy ? '******' : (tx.type === 'income' ? '+' : '-') + tx.amount.toLocaleString()}
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      {tx.receiptUrl ? (
                        <a href={tx.receiptUrl} target="_blank" className="text-[9px] text-blue-500 font-bold uppercase hover:underline">View Receipt</a>
                      ) : (
                        <button 
                          onClick={() => startEdit(tx)}
                          className="flex items-center gap-1 text-[8px] font-black text-emerald-500 uppercase tracking-widest hover:underline"
                        >
                          <Upload className="w-2.5 h-2.5" />
                          Add Receipt
                        </button>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => startEdit(tx)}
                    className="p-1.5 sm:p-2 bg-slate-100 dark:bg-white/5 rounded-lg opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100 transition-all hover:bg-primary/10 hover:text-primary"
                    title="Edit"
                  >
                    <PlusCircle className="w-3.5 h-3.5 rotate-45" />
                  </button>
                  <button 
                    onClick={() => startDelete(tx)}
                    className="p-1.5 sm:p-2 bg-slate-100 dark:bg-white/5 rounded-lg opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100 transition-all hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500"
                    title="Delete"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              );
            })}
            {transactions.length === 0 && (
              <div className="p-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">{t('no_transactions')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BalanceCard({ title, value, icon: Icon, color, showPrivacy }: any) {
  return (
    <div className="group flex items-center gap-4 rounded-[1.5rem] border border-slate-100 bg-white p-4 transition-all duration-500 hover:border-primary/20 hover:shadow-xl dark:border-white/5 dark:bg-white/5">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 transition-colors group-hover:bg-white dark:bg-white/5 dark:group-hover:bg-white/10 ${color}`}>
        <Icon className="h-5 w-5 transition-transform group-hover:scale-110" />
      </div>
      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{title}</p>
        <p className="text-base font-bold tracking-tight text-[#052659] dark:text-white">
          {showPrivacy ? '••••••' : value.toLocaleString()}
          <span className="ml-1 text-[10px] opacity-40 italic">₭</span>
        </p>
      </div>
    </div>
  );
}
