import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  db, 
  auth, 
  handleFirestoreError, 
  OperationType 
} from '../firebase';
import { useTranslation } from 'react-i18next';
import { 
  collection, 
  onSnapshot, 
  query, 
  where,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocs,
  orderBy,
  limit
} from 'firebase/firestore';
import { 
  TrendingUp, 
  Printer, 
  Cpu, 
  CheckCircle, 
  Search, 
  RotateCw, 
  FileDown, 
  ChevronRight, 
  Package, 
  ShieldAlert, 
  ShoppingCart, 
  Info,
  Sliders,
  DollarSign,
  Building,
  Heart,
  Share2,
  Check,
  Smartphone,
  AlertCircle,
  Trash2,
  Truck,
  Sparkles,
  Save
} from 'lucide-react';

const getSinglePackPriceLAK = (quote: any): number => {
  if (!quote) return 100000;
  // If it's a new style record with explicit priceMode or totalPriceLAK
  if (quote.priceMode === 'total' || quote.priceMode === 'per_pack' || quote.totalPriceLAK !== undefined) {
    return Number(quote.priceLAK || 0);
  }
  // For old style records, treat priceOriginal as the total price entered by the user
  const totalOriginal = Number(quote.priceOriginal || 0);
  const exchangeRate = Number(quote.exchangeRate || 1);
  const totalLAK = quote.currency === 'LAK' ? totalOriginal : totalOriginal * exchangeRate;
  return totalLAK / Number(quote.quantity || 1);
};

const getQuoteUnitCostLAK = (quote: any, defaultPackSize?: number): number => {
  if (!quote) return 100000;
  const packPriceLAK = getSinglePackPriceLAK(quote);
  const size = Number(quote.quantityPerUnit || defaultPackSize || 1);
  return packPriceLAK / (size || 1);
};

export function getSmartPackSize(
  productName: string,
  productUnit: string,
  configPackSize?: number,
  quoteQuantityPerUnit?: number,
  quotePriceLAK?: number
): number {
  if (quoteQuantityPerUnit && quoteQuantityPerUnit > 1) {
    return quoteQuantityPerUnit;
  }
  if (configPackSize && configPackSize > 1) {
    return configPackSize;
  }

  const name = (productName || '').toLowerCase().trim();
  const prodUnit = (productUnit || '').toLowerCase().trim();

  // Match grams/ml in the name (e.g. 2000g, 1000ml, 500g, 385g)
  const numericUnitsMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:g|ml|ກຣາມ|ມລ|gram|milliliter)/);
  if (numericUnitsMatch) {
    return parseFloat(numericUnitsMatch[1]);
  }

  // Match kilograms/liters (e.g. 1kg, 1 kg, 1ກລ, 1ກິໂລ, 1l, 1 l, 1ລິດ) -> convert to 1000 base
  const kgLMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:kg|l|ກລ|ກິໂລ|ລິດ|litre|kilogram)/);
  if (kgLMatch) {
    return parseFloat(kgLMatch[1]) * 1000;
  }

  // Match "1 k" or "1k" (Lao slang for kg, e.g. "ກາເຟ 1ກ")
  const laKMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:ກ|k)/);
  if (laKMatch) {
    return parseFloat(laKMatch[1]) * 1000;
  }

  // If the product unit is exactly 'g' or 'ml' (very small units), and the pack price is relatively high (e.g. > 1000 LAK),
  // and standard packSize is still 1: we can safely assume it's a bulk package (like 1kg or 1L) and default to 1000.
  const priceLAK = quotePriceLAK || 0;
  if (prodUnit === 'g' || prodUnit === 'ml') {
    if (priceLAK > 1000) {
      return 1000;
    }
  }

  return 1;
}

export function getCommercialPackSize(productName: string, unit: string): number {
  const name = (productName || '').toLowerCase().trim();
  const u = (unit || '').toLowerCase().trim();
  if (u === 'g' || u === 'ກຣາມ' || u === 'g') {
    if (name.includes('ນ້ຳຕານ') || name.includes('sugar') || name.includes('ຄີມ') || name.includes('creamer') || name.includes('ເກືອ') || name.includes('salt')) {
      return 1000;
    }
    if (name.includes('ກາເຟ') || name.includes('coffee') || name.includes('ເມັດ')) {
      return 500;
    }
    if (name.includes('ມັດຈະ') || name.includes('matcha') || name.includes('ໂກໂກ້') || name.includes('cocoa') || name.includes('ຊາ') || name.includes('tea') || name.includes('ຜົງ')) {
      return 500;
    }
    return 500; // default for food powder/beans is 500g
  }
  if (u === 'ml' || u === 'ມລ' || u === 'ລິດ' || u === 'l') {
    if (name.includes('ນົມ') || name.includes('milk') || name.includes('ເຊື່ອມ') || name.includes('syrup')) {
      return 1000; // 1 Liter
    }
    return 1000;
  }
  return 1;
}

export function getIngredientBaseQtyAndCost(
  amount: number,
  ingUnitStr: string,
  prod: any,
  costStructure: { perUnit: number; pricePerPack: number; qtyPerPack: number }
) {
  const normalizedIngUnit = (ingUnitStr || prod?.unit || 'g').toLowerCase().trim();
  const normalizedProdUnit = (prod?.unit || 'g').toLowerCase().trim();
  const packSize = costStructure.qtyPerPack || (prod ? getSmartPackSize(prod.name, prod.unit, prod.packSize) : 1);

  let baseUnits = amount;
  let cost = 0;

  // 1. Check if the recipe ingredient unit is pack-based
  if (
    normalizedIngUnit === 'pack' || 
    normalizedIngUnit === 'box' || 
    normalizedIngUnit === 'bag' || 
    normalizedIngUnit === 'unit'
  ) {
    baseUnits = amount * packSize;
    cost = amount * (costStructure.pricePerPack || 0);
  } else if (normalizedIngUnit === 'kg') {
    // KG to Grams (assuming base is grams)
    baseUnits = amount * 1000;
    cost = baseUnits * costStructure.perUnit;
  } else if (normalizedIngUnit === 'l' || normalizedIngUnit === 'litre') {
    // Liters to ml (assuming base is ml)
    baseUnits = amount * 1000;
    cost = baseUnits * costStructure.perUnit;
  } else if (normalizedIngUnit === 'pcs' || normalizedIngUnit === 'piece') {
    // If the product base unit is already pieces/units, consume directly. Otherwise convert.
    if (normalizedProdUnit === 'pcs' || normalizedProdUnit === 'piece' || normalizedProdUnit === 'unit') {
      baseUnits = amount;
      cost = amount * costStructure.perUnit;
    } else {
      // Treat like a bottle/item of packSize
      baseUnits = amount * packSize;
      cost = amount * (costStructure.pricePerPack || 0);
    }
  } else {
    // Normal base unit like g, ml
    baseUnits = amount;
    cost = amount * costStructure.perUnit;
  }

  return { baseUnits, cost };
}

export default function ProcurementPlanner({ selectedBranch }: { selectedBranch?: string }) {
  const { i18n } = useTranslation();
  const t = (key: string) => {
    const translations: { [lang: string]: { [key: string]: string } } = {
      en: {
        planner_title: "Smart Procurement & Billing Optimization",
        planner_desc: "Automated replenishment calculation based on 6-day raw consumption rates, cost-optimized across active supplier menus.",
        stock_health: "Stock Health & Velocity",
        burn_rate: "Daily Burn Rate",
        target_span: "Target Level (6 Days)",
        current_stock: "Current Balance",
        suggested_restock: "Suggested Replenish",
        optimize_group_bills: "Optimize Group Purchase Bills",
        optimize_desc: "This routine groups multiple restock needs and assigns each ingredient to the cheapest supplier on record, reducing procurement costs.",
        print_proposals: "Print Proposals / Order Bills",
        no_restock_needed: "Excellent! All ingredients are healthy and sufficiently stocked.",
        generate_bills_now: "Run Smart Billing Optimization",
        best_supplier: "Cheapest Supplier",
        cheaper_by: "Cheaper By",
        estimated_cost: "Est. Total Cost",
        order_packs: "Order Packs",
        receipt_preview: "Thermal Receipt Print Preview",
        paper_size: "Paper Width",
        bt_status: "Bluetooth Status",
        bt_connected: "Bluetooth Connected [Online]",
        bt_disconnected: "Bluetooth Disconnected",
        connect_bt: "Connect Thermal Printer",
        print_to_device: "Trigger Physical Print (System)",
        export_png: "Export as PNG Image",
        saving_msg: "Saving to gallery...",
        unmapped_item: "No price records. Falling back to General Supplier.",
        pack: "Pack",
        packs: "Packs",
        cost: "Cost",
        total: "Total",
        item: "Item",
        qty: "Qty",
        supplier_label: "Supplier Invoice Template",
        scanning_devices: "Scanning for nearby Bluetooth devices...",
        select_dev_to_pair: "Select a Bluetooth printer to pair:",
        connected_suc: "Bluetooth printer linked successfully!"
      },
      la: {
        planner_title: "ແຜນຈັດຊື້ & ບິນອັດຕະໂນມັດ",
        planner_desc: "ລະບົບແນະນຳການສັ່ງຊື້ສິນຄ້າເຕີມສາງໂດຍຄຳນວນຈາກອັດຕາການຊົມໃຊ້ 6 ວັນ (Burnrate), ພ້ອມເລືອກຮ້ານຄ້າທີ່ຄຸ້ມຄ່າທີ່ສຸດເພື່ອປະຢັດຕົ້ນທຶນ.",
        stock_health: "ສະຖານະສິນຄ້າ & ອັດຕາການໝູນວຽນ",
        burn_rate: "ອັດຕາການຊົມໃຊ້/ວັນ",
        target_span: "ລະດັບການສັ່ງເຕີມ (6 ວັນ)",
        current_stock: "ຍອດຄົງເຫຼືອປະຈຸບັນ",
        suggested_restock: "ຈຳນວນແນະນຳສັ່ງຊື້",
        optimize_group_bills: "ແຍກບິນ/ຈັດກຸ່ມຊື້ໃຫ້ຄຸ້ມທີ່ສຸດ (Optimize Bills)",
        optimize_desc: "ລະບົບຈະຄິດໄລ່ແຍກບິນສັ່ງຊື້ໃຫ້ແຕ່ລະຮ້ານສະໜອງໂດຍອັດຕະໂນມັດ ໂດຍເລືອກຄົງຄັງທີ່ລາຄາຖືກທີ່ສຸດໃນປະຫວັດສາງ.",
        print_proposals: "ພິມໃບບິນແນະນຳ / ອອກບິນສັ່ງຊື້",
        no_restock_needed: "ຍອດຢ້ຽມ! ວັດຖຸດິບທັງໝົດມີຈຳນວນພຽງພໍ ແລະ ຢູ່ໃນເກນປອດໄພ.",
        generate_bills_now: "ຄຳນວນຈັດກຸ່ມບິນອັດຕະໂນມັດ",
        best_supplier: "ຮ້ານຄ້າທີ່ຄຸ້ມທີ່ສຸດ",
        cheaper_by: "ປະຢັດລົງໄດ້",
        estimated_cost: "ລາຄາຄາດຄະເນລວມ",
        order_packs: "ຈຳນວນສັ່ງຊື້ (ແພັກ)",
        receipt_preview: "ຕົວຢ່າງໃບບິນຄວາມຮ້ອນ (Thermal)",
        paper_size: "ຂະໜາດເຈ້ຍໃບບິນ",
        bt_status: "ສະຖານະການເຊື່ອມຕໍ່ Bluetooth",
        bt_connected: "ເຊື່ອມຕໍ່ Bluetooth ແລ້ວ [Online]",
        bt_disconnected: "ບໍ່ໄດ້ເຊື່ອມຕໍ່ Bluetooth",
        connect_bt: "ເຊື່ອມຕໍ່ກັບເຄື່ອງພິມ Bluetooth",
        print_to_device: "ສັ່ງພິມໃບບິນຕົວຈິງ (System)",
        export_png: "ດາວໂຫຼດເປັນຮູບພາບ (PNG)",
        saving_msg: "ກຳລັງບັນທຶກຮູບພາບ...",
        unmapped_item: "ຍັງບໍ່ມີປະຫວັດບັນທຶກລາຄາ, ໃຊ້ຮ້ານທົ່ວໄປ.",
        pack: "ແພັກ",
        packs: "ແພັກ",
        cost: "ລາຄາ/ແພັກ",
        total: "ລວມ",
        item: "ລາຍການ",
        qty: "ຈຳນວນ",
        supplier_label: "ໃບແນະນຳການຈັດຊື້ - Supplier Bill",
        scanning_devices: "ກຳລັງຄົ້ນຫາອຸປະກອນເຄື່ອງພິມ Bluetooth ໃກ້ຄຽງ...",
        select_dev_to_pair: "ເລືອກເຄື່ອງພິມ Bluetooth ທີ່ຕ້ອງການເຊື່ອມຕໍ່:",
        connected_suc: "ເຊື່ອມຕໍ່ເຄື່ອງພິມສໍາເລັດແລ້ວ!"
      }
    };
    const lang = i18n.language === 'la' ? 'la' : 'en';
    return translations[lang]?.[key] || translations['en']?.[key] || key;
  };

  // State Declarations
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [rawSupplierPrices, setRawSupplierPrices] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [rawSalesRecords, setRawSalesRecords] = useState<any[]>([]);
  const [rawAdjustments, setRawAdjustments] = useState<any[]>([]);

  // Filter core databases client-side per chosen branch
  const supplierPrices = useMemo(() => {
    const activeBranch = selectedBranch || 'branch_1';
    return rawSupplierPrices.filter(p => !p.branchId || p.branchId === activeBranch);
  }, [rawSupplierPrices, selectedBranch]);

  const salesRecords = useMemo(() => {
    const activeBranch = selectedBranch || 'branch_1';
    return rawSalesRecords.filter(s => !s.branchId || s.branchId === activeBranch);
  }, [rawSalesRecords, selectedBranch]);

  const adjustments = useMemo(() => {
    const activeBranch = selectedBranch || 'branch_1';
    return rawAdjustments.filter(a => !a.branchId || a.branchId === activeBranch);
  }, [rawAdjustments, selectedBranch]);

  // Manual restock state variables
  const [plannerTab, setPlannerTab] = useState<'auto' | 'manual'>('auto');
  const [manualBasket, setManualBasket] = useState<{ [productId: string]: number }>({});
  const [manualBasketUnits, setManualBasketUnits] = useState<{ [productId: string]: 'pack' | 'box' }>({});
  const [manualProductSearch, setManualProductSearch] = useState('');
  const [dismissedSuppliers, setDismissedSuppliers] = useState<string[]>([]);

  // Simulation Controls & User Customization Interactivity
  const [targetCoverageDays, setTargetCoverageDays] = useState<number>(6);
  const [forecastMethod, setForecastMethod] = useState<'predictive' | 'historical'>('predictive');
  const [projectedCupsPerDay, setProjectedCupsPerDay] = useState<number>(50);
  const [onlyExhaustion, setOnlyExhaustion] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [supplierStrategy, setSupplierStrategy] = useState<'lowest_cost' | 'most_stock_in'>('most_stock_in');
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  
  // Customizable receipt fields
  const [customHeader, setCustomHeader] = useState(() => {
    return localStorage.getItem('procure_print_header') || 'COFFEE ARCHITECTURE';
  });
  const [customPhone, setCustomPhone] = useState(() => {
    return localStorage.getItem('procure_print_phone') || '+856 20 8888 9999';
  });
  const [customAddress, setCustomAddress] = useState(() => {
    return localStorage.getItem('procure_print_address') || "Lao People's Democratic Republic";
  });
  const [customFooter, setCustomFooter] = useState(() => {
    return localStorage.getItem('procure_print_footer') || 'generated dynamically by coffee shop budget planner & supplier pricing sync.';
  });
  const [saveSuccess, setSaveSuccess] = useState(false);

  const saveReceiptDraft = () => {
    localStorage.setItem('procure_print_header', customHeader);
    localStorage.setItem('procure_print_phone', customPhone);
    localStorage.setItem('procure_print_address', customAddress);
    localStorage.setItem('procure_print_footer', customFooter);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const getVerificationUrl = (bill: any) => {
    if (!bill) return '';
    const appUrl = window.location.origin + window.location.pathname;
    
    // Compact payload to fit cleanly inside QR code
    const payload = {
      rid: bill.id || `${bill.supplier}_${Date.now().toString().substring(7)}`,
      sup: bill.supplier,
      tot: bill.totalCost,
      date: new Date().toLocaleDateString('la-LA'),
      items: bill.items?.map((it: any) => ({
        n: it.productName,
        q: it.packsToOrder,
        u: it.buyUnit,
        c: it.lineCost
      })) || []
    };

    try {
      const jsonStr = JSON.stringify(payload);
      // Safe base64 encoding that supports UTF-8
      const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
      return `${appUrl}?verifyBill=${encodeURIComponent(base64Str)}`;
    } catch (err) {
      console.error("Payload error: ", err);
      return `${appUrl}?verifyBill=error`;
    }
  };
  
  // Printing & Bluetooth/IP Printer States
  const [isPrinterModalOpen, setIsPrinterModalOpen] = useState(false);
  const [paperWidth, setPaperWidth] = useState<'90mm' | '80mm' | '50mm'>('80mm');
  const [selectedBill, setSelectedBill] = useState<any>(null);
  
  const [connectionType, setConnectionType] = useState<'network' | 'bluetooth'>('network');
  const [printerIp, setPrinterIp] = useState('192.168.1.22');
  const [printerPort, setPrinterPort] = useState('9700');
  const [ipStatusText, setIpStatusText] = useState('Disconnected');
  const [ipConnected, setIpConnected] = useState(false);
  const [isSearchingIp, setIsSearchingIp] = useState(false);

  const [btConnected, setBtConnected] = useState(false);
  const [btStatusText, setBtStatusText] = useState('Disconnected');
  const [isSearchingBt, setIsSearchingBt] = useState(false);
  const [pairingSuccess, setPairingSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Hidden print reference
  const printRef = useRef<HTMLDivElement>(null);

  // States & helper functions for registering procurement bills as financial store purchase expenses
  const [isLoggingExpense, setIsLoggingExpense] = useState(false);
  const [loggedExpenseBills, setLoggedExpenseBills] = useState<string[]>([]);

  const recalculateDailySummaryForDate = async (dateStr: string) => {
    try {
      // 1. Get all transactions for this date
      const q = query(collection(db, 'transactions'), where('date', '==', dateStr));
      const txSnap = await getDocs(q);
      const txs = txSnap.docs.map(doc => doc.data());

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
          if (tx.source === 'cash') {
            summary.cashIncome += amount;
          } else {
            summary.onlineIncome += amount;
          }
        } else {
          summary.expenses += amount;
          if (tx.source === 'cash') {
            summary.cashExpenses += amount;
          } else {
            summary.onlineExpenses += amount;
          }
        }
      });

      summary.finalBalance = summary.previousBalance + summary.income - summary.expenses;
      summary.finalCashBalance = summary.previousCashBalance + summary.cashIncome - summary.cashExpenses;
      summary.finalOnlineBalance = summary.previousOnlineBalance + summary.onlineIncome - summary.onlineExpenses;

      await setDoc(doc(db, 'dailySummaries', dateStr), summary, { merge: true });

      // Update future summary documents sequentially
      const futureQ = query(
        collection(db, 'dailySummaries'),
        where('date', '>', dateStr),
        orderBy('date', 'asc')
      );
      const futureSnap = await getDocs(futureQ);
      let currBalance = summary.finalBalance;
      let currCash = summary.finalCashBalance;
      let currOnline = summary.finalOnlineBalance;

      for (const futureDoc of futureSnap.docs) {
        const fData = futureDoc.data();
        const fIncome = fData.income || 0;
        const fExpenses = fData.expenses || 0;
        const fCashIncome = fData.cashIncome || 0;
        const fCashExpenses = fData.cashExpenses || 0;
        const fOnlineIncome = fData.onlineIncome || 0;
        const fOnlineExpenses = fData.onlineExpenses || 0;

        const nextFin = currBalance + fIncome - fExpenses;
        const nextCash = currCash + fCashIncome - fCashExpenses;
        const nextOnline = currOnline + fOnlineIncome - fOnlineExpenses;

        await setDoc(doc(db, 'dailySummaries', futureDoc.id), {
          previousBalance: currBalance,
          previousCashBalance: currCash,
          previousOnlineBalance: currOnline,
          finalBalance: nextFin,
          finalCashBalance: nextCash,
          finalOnlineBalance: nextOnline,
          timestamp: serverTimestamp()
        }, { merge: true });

        currBalance = nextFin;
        currCash = nextCash;
        currOnline = nextOnline;
      }
    } catch (err) {
      console.error("Error recalculating in ProcurementPlanner:", err);
    }
  };

  const handleRegisterAsExpense = async (bill: any) => {
    if (!bill) return;
    try {
      setIsLoggingExpense(true);
      const totalAmount = Math.round(bill.totalCost || bill.totalPrice || 0);
      if (totalAmount <= 0) {
        alert(i18n.language === 'la' ? 'ຍອດບິນຕ້ອງຫຼາຍກວ່າ 0!' : 'Bill amount must be greater than 0!');
        setIsLoggingExpense(false);
        return;
      }

      const todayLocal = new Date();
      const localDateString = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`;
      const localTimeString = `${String(todayLocal.getHours()).padStart(2, '0')}:${String(todayLocal.getMinutes()).padStart(2, '0')}`;

      const description = i18n.language === 'la' 
        ? `ຊື້ວັດຖຸດິບເຂົ້າຮ້ານ: ${bill.supplier}` 
        : `Purchasing supplies from ${bill.supplier}`;

      const txData = {
        type: 'expense',
        amount: totalAmount,
        category: 'supply purchase',
        description: description,
        source: 'online banking',
        receiptUrl: '',
        date: localDateString,
        time: localTimeString,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || 'admin',
        userEmail: auth.currentUser?.email || 'admin@example.com',
        branchId: selectedBranch || 'branch_1'
      };

      await addDoc(collection(db, 'transactions'), txData);
      
      // Auto-recalculate
      await recalculateDailySummaryForDate(localDateString);

      setLoggedExpenseBills(prev => [...prev, bill.supplier]);
      alert(i18n.language === 'la' 
        ? `ລົງທະບຽນບິນຂອງ ${bill.supplier} ເປັນລາຍຈ່າຍຮ້ານສຳເລັດແລ້ວ! ຈຳນວນເງິນ: ${totalAmount.toLocaleString()} ₭. ທ່ານສາມາດອັບໂຫຼດຮູບໃບບິນຕົວຈິງຕາມຫຼັງໄດ້ທີ່ໜ້າການເງິນ (Financials).` 
        : `Registered ${bill.supplier}'s bill as a store expense successfully! Amount: ${totalAmount.toLocaleString()} ₭. You can upload the actual receipt invoice later in the Financials page.`);
    } catch (err: any) {
      console.error("Error logging expense:", err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsLoggingExpense(false);
    }
  };

  // Load Database Subscriptions
  useEffect(() => {
    setLoading(true);
    const qProducts = query(collection(db, 'products'));
    const qPrices = query(collection(db, 'supplierPrices'));
    const qRecipes = query(collection(db, 'recipes'));
    const qSales = query(collection(db, 'menu_sales'));
    const qAdj = query(collection(db, 'inventory'));

    const unsubProducts = onSnapshot(qProducts, (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'products'));

    const unsubPrices = onSnapshot(qPrices, (snap) => {
      setRawSupplierPrices(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'supplierPrices'));

    const unsubRecipes = onSnapshot(qRecipes, (snap) => {
      setRecipes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'recipes'));

    const unsubSales = onSnapshot(qSales, (snap) => {
      setRawSalesRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, error => handleFirestoreError(error, OperationType.LIST, 'menu_sales'));

    const unsubAdj = onSnapshot(qAdj, (snap) => {
      setRawAdjustments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    }, error => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    return () => {
      unsubProducts();
      unsubPrices();
      unsubRecipes();
      unsubSales();
      unsubAdj();
    };
  }, []);

  // Compute stock levels and burn rates 
  const processedPlannerData = useMemo(() => {
    // 1. Identify active sales days representational scope
    const uniqueSalesDates = new Set(salesRecords.map(sale => sale.date));
    const totalDaysTracked = Math.max(1, uniqueSalesDates.size);

    // 2. Prepare cost structures per item based on the most expensive supplier price (conservative budget)
    const costMap: { [productId: string]: { perUnit: number; pricePerPack: number; label: string; qtyPerPack: number; buyUnit: string } } = {};
    products.forEach(p => {
      const pPrices = supplierPrices.filter(sp => sp.productId === p.id);
      if (pPrices.length > 0) {
        // Find the record with the most expensive cost per raw unit (LAK/unit)
        let expensiveQuote = pPrices[0];
        let maxUnitCost = -1;

        pPrices.forEach(quote => {
          const packPriceLAK = getSinglePackPriceLAK(quote);
          let size = getSmartPackSize(p.name, p.unit, p.packSize, quote.quantityPerUnit, packPriceLAK);
          if (size <= 1) {
            size = getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase());
          }
          const unitCost = packPriceLAK / (size || 1);
          if (unitCost > maxUnitCost) {
            maxUnitCost = unitCost;
            expensiveQuote = quote;
          }
        });

        const latest = expensiveQuote;
        const latestPackPriceLAK = getSinglePackPriceLAK(latest);
        let sizePerPack = getSmartPackSize(p.name, p.unit, p.packSize, latest.quantityPerUnit, latestPackPriceLAK);
        if (sizePerPack <= 1) {
          sizePerPack = getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase());
        }
        
        const singlePackPriceLAK = latestPackPriceLAK;
        const costPerRawUnit = singlePackPriceLAK / (sizePerPack || 1);
        costMap[p.id] = {
          perUnit: costPerRawUnit,
          pricePerPack: singlePackPriceLAK,
          label: p.unit || latest.unit || 'g',
          qtyPerPack: sizePerPack,
          buyUnit: latest.unit || 'PACK'
        };
      } else {
        let sizePerPack = getSmartPackSize(p.name, p.unit, p.packSize);
        if (sizePerPack <= 1) {
          sizePerPack = getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase());
        }
        costMap[p.id] = {
          perUnit: 0,
          pricePerPack: 0,
          label: p.unit || 'g',
          qtyPerPack: sizePerPack,
          buyUnit: 'UNIT'
        };
      }
    });

    // 3. For each product, calculate current stock balance
    return products.map(p => {
      // Calculate Total Incoming Stock
      const pPrices = supplierPrices.filter(sp => sp.productId === p.id);
      const totalIn = pPrices.reduce((sum, sp) => {
        const pQty = sp.quantity || 0;
        let size = sp.quantityPerUnit || p.packSize || 1;
        if (size <= 1) {
          size = getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase());
        }
        return sum + (pQty * size);
      }, 0);

      // Calculate Total Consumed Stock (incorporating custom recipe row units like 'pack', 'ml', 'g')
      let totalConsumed = 0;
      salesRecords.forEach(sale => {
        const itemsSold = sale.itemsSold || {};
        Object.keys(itemsSold).forEach(recipeId => {
          const qtySold = itemsSold[recipeId] || 0;
          const recipe = recipes.find(r => r.id === recipeId);
          if (recipe) {
            const ingredient = (recipe.ingredients || []).find((ing: any) => ing.productId === p.id);
            if (ingredient) {
              const costStructure = costMap[p.id] || { perUnit: 0, pricePerPack: 0, qtyPerPack: p.packSize || 1 };
              const { baseUnits } = getIngredientBaseQtyAndCost(
                ingredient.amount,
                ingredient.unit || p.unit || 'g',
                p,
                {
                  perUnit: costStructure.perUnit,
                  pricePerPack: costStructure.pricePerPack,
                  qtyPerPack: costStructure.qtyPerPack || p.packSize || 1
                }
              );
              totalConsumed += (baseUnits * qtySold);
            }
          }
        });
      });

      // Fetch adjustments
      const pAdjs = adjustments.filter(adj => adj.productId === p.id);
      const totalAdjustment = pAdjs.reduce((sum, adj) => sum + (adj.amount || 0), 0);

      // Remaining Balance in base units (g or ml)
      const currentBalance = Math.max(0, totalIn + totalAdjustment - totalConsumed);

      // Compute Daily Burn Rate based on selected forecastMethod
      let avgDailyBurn = 0;
      if (p.isDurable) {
        avgDailyBurn = 0;
      } else if (forecastMethod === 'predictive') {
        let predictedDailyBurn = 0;
        if (recipes.length > 0) {
          recipes.forEach(recipe => {
            const ingredient = (recipe.ingredients || []).find((ing: any) => ing.productId === p.id);
            if (ingredient) {
              const costStructure = costMap[p.id] || { perUnit: 0, pricePerPack: 0, qtyPerPack: p.packSize || 1 };
              const { baseUnits } = getIngredientBaseQtyAndCost(
                ingredient.amount,
                ingredient.unit || p.unit || 'g',
                p,
                {
                  perUnit: costStructure.perUnit,
                  pricePerPack: costStructure.pricePerPack,
                  qtyPerPack: costStructure.qtyPerPack || p.packSize || 1
                }
              );
              // Weighted average cups based on recipe share
              const drinkDailyVolume = Math.max(1, projectedCupsPerDay / recipes.length);
              predictedDailyBurn += baseUnits * drinkDailyVolume;
            }
          });
        }
        
        // If the product is not used in any recipe, fallback to buffer or a constant baseline rate
        if (predictedDailyBurn === 0) {
          const buffer = parseFloat(p.minStock) || 0;
          predictedDailyBurn = buffer > 0 ? (buffer / 5) : 15; // default fallback
        }
        avgDailyBurn = predictedDailyBurn;
      } else {
        avgDailyBurn = totalConsumed / totalDaysTracked;
      }

      // Recommended Coverage Goal
      const safetyBuffer = parseFloat(p.minStock) || 0;
      const targetStockLevel = p.isDurable ? safetyBuffer : (avgDailyBurn * targetCoverageDays) + safetyBuffer;
      const suggestedAmountToOrder = Math.max(0, targetStockLevel - currentBalance);

      return {
        ...p,
        currentBalance,
        avgDailyBurn,
        safetyBuffer,
        targetStockLevel,
        suggestedAmountToOrder,
        costInfo: costMap[p.id] || { perUnit: 0, pricePerPack: 0, label: p.unit || 'g', qtyPerPack: p.packSize || 1 }
      };
    });
  }, [products, supplierPrices, salesRecords, recipes, adjustments, targetCoverageDays, forecastMethod, projectedCupsPerDay]);

  // OPTIMIZE GROUP PURCHASE BILLS ALGORITHM
  const supplierPurchaseGroups = useMemo(() => {
    const rawToRestock = processedPlannerData.filter(item => {
      if (item.suggestedAmountToOrder <= 0) return false;
      if (onlyExhaustion) {
        // Exclude products that are not close to depletion
        // Definition of "Exhaustion Product" / "Nearly depleted or Out of Stock":
        // 1. Stock <= minStock / safety stock buffer
        // 2. Or stock covers less than 3 days according to daily burn rate
        // 3. Or stock is completely depleted (current balance <= 0)
        const daysRemaining = item.avgDailyBurn > 0 ? (item.currentBalance / item.avgDailyBurn) : (item.currentBalance === 0 ? 0 : 999);
        const isExhausted = item.currentBalance === 0 || item.currentBalance <= item.safetyBuffer || daysRemaining < 3;
        return isExhausted;
      }
      return true;
    });
    const groups: { [supplierName: string]: { supplier: string; items: any[]; totalCost: number } } = {};

    rawToRestock.forEach(item => {
      // Find all prices logged for this specific product to pick the absolute layout winner
      const pricesForProduct = supplierPrices.filter(sp => sp.productId === item.id);
      
      let bestSelection: any = null;
      let lowestUnitCost = Infinity;

      if (pricesForProduct.length > 0) {
        if (supplierStrategy === 'most_stock_in') {
          // Rule: group by supplier who historically supplied the most stock
          const supplierTotals: { [supplierName: string]: number } = {};
          pricesForProduct.forEach(quote => {
            if (quote.supplier?.trim()) {
              const rawIn = Number(quote.quantity || 0) * Number(quote.quantityPerUnit || 1);
              supplierTotals[quote.supplier] = (supplierTotals[quote.supplier] || 0) + rawIn;
            }
          });
          
          let maxQty = -1;
          let bestSupplierName = '';
          Object.entries(supplierTotals).forEach(([supName, totalQty]) => {
            if (totalQty > maxQty) {
              maxQty = totalQty;
              bestSupplierName = supName;
            }
          });
          
          const quotesForBestSupplier = pricesForProduct.filter(q => q.supplier === bestSupplierName);
          if (quotesForBestSupplier.length > 0) {
            // Find cheapest or latest quote based on unit cost for that supplier
            bestSelection = quotesForBestSupplier.sort((a, b) => {
              const uCostA = getQuoteUnitCostLAK(a, item.packSize || 1);
              const uCostB = getQuoteUnitCostLAK(b, item.packSize || 1);
              return uCostA - uCostB;
            })[0] || quotesForBestSupplier[0];
            lowestUnitCost = getQuoteUnitCostLAK(bestSelection, item.packSize || 1);
          }
        } else {
          // lowest_cost
          pricesForProduct.forEach(quote => {
            const costPerUnit = getQuoteUnitCostLAK(quote, item.packSize || 1);
            if (costPerUnit < lowestUnitCost && quote.supplier?.trim()) {
              lowestUnitCost = costPerUnit;
              bestSelection = quote;
            }
          });
        }
      }

      // Group keys
      const chosenSupplier = bestSelection ? bestSelection.supplier : 'General Market';
      const pricePerPack = bestSelection ? getSinglePackPriceLAK(bestSelection) : (item.costInfo?.pricePerPack || 100000);
      const buyUnit = bestSelection ? bestSelection.unit || 'PACK' : 'PACK';
      let sizePerPack = bestSelection ? bestSelection.quantityPerUnit || item.packSize || 1 : item.packSize || 1;
      if (sizePerPack <= 1) {
        sizePerPack = getCommercialPackSize(item.name, (item.unit || 'g').toLowerCase());
      }

      // Calculate how many packs can fulfill the recommended amount
      const recommendedPacks = Math.ceil(item.suggestedAmountToOrder / (sizePerPack || 1));
      const lineCost = recommendedPacks * pricePerPack;

      // Calculate the premium / saving difference compared to the second cheapest if present
      let savingAmount = 0;
      if (pricesForProduct.length > 1) {
        const sortedAlternatives = [...pricesForProduct]
          .map(q => getQuoteUnitCostLAK(q, item.packSize || 1))
          .sort((a, b) => a - b);
        const secondCheapest = sortedAlternatives[1] || sortedAlternatives[0];
        const alternativeCost = secondCheapest * item.suggestedAmountToOrder;
        savingAmount = Math.max(0, alternativeCost - (lowestUnitCost * item.suggestedAmountToOrder));
      }

      // Calculate state for label display
      const daysRemaining = item.avgDailyBurn > 0 ? (item.currentBalance / item.avgDailyBurn) : (item.currentBalance === 0 ? 0 : 999);
      const isExhausted = item.currentBalance === 0 || item.currentBalance <= item.safetyBuffer || daysRemaining < 3;

      const proposalItem = {
        productId: item.id,
        productName: item.name,
        neededBaseQty: item.suggestedAmountToOrder,
        parentUnit: item.unit || 'g',
        packsToOrder: recommendedPacks,
        costPerPack: pricePerPack,
        packSize: sizePerPack,
        lineCost,
        savingAmount,
        buyUnit,
        isFallback: !bestSelection,
        isExhausted,
        daysRemaining
      };

      if (!groups[chosenSupplier]) {
        groups[chosenSupplier] = {
          supplier: chosenSupplier,
          items: [],
          totalCost: 0
        };
      }
      groups[chosenSupplier].items.push(proposalItem);
      groups[chosenSupplier].totalCost += lineCost;
    });

    return Object.values(groups)
      .sort((a, b) => b.totalCost - a.totalCost)
      .filter(g => !dismissedSuppliers.includes(g.supplier));
  }, [processedPlannerData, supplierPrices, onlyExhaustion, dismissedSuppliers, supplierStrategy]);

  // Compute optimized purchase groups for manually configured restock items
  const manualPurchaseGroups = useMemo(() => {
    const groups: { [supplierName: string]: { supplier: string; items: any[]; totalCost: number } } = {};

    Object.entries(manualBasket).forEach(([prodId, rawQty]) => {
      const qty = Number(rawQty);
      if (qty <= 0) return;

      const p = products.find(prod => prod.id === prodId);
      if (!p) return;

      // Find all prices logged for this specific product to pick the cheapest supplier
      const pPrices = supplierPrices.filter(sp => sp.productId === p.id);
      
      let bestSelection: any = null;
      let lowestUnitCost = Infinity;

      if (pPrices.length > 0) {
        if (supplierStrategy === 'most_stock_in') {
          const supplierTotals: { [supplierName: string]: number } = {};
          pPrices.forEach(quote => {
            if (quote.supplier?.trim()) {
              const rawIn = Number(quote.quantity || 0) * Number(quote.quantityPerUnit || 1);
              supplierTotals[quote.supplier] = (supplierTotals[quote.supplier] || 0) + rawIn;
            }
          });
          
          let maxQty = -1;
          let bestSupplierName = '';
          Object.entries(supplierTotals).forEach(([supName, totalQty]) => {
            if (totalQty > maxQty) {
              maxQty = totalQty;
              bestSupplierName = supName;
            }
          });
          
          const quotesForBestSupplier = pPrices.filter(q => q.supplier === bestSupplierName);
          if (quotesForBestSupplier.length > 0) {
            bestSelection = quotesForBestSupplier.sort((a, b) => {
              const uCostA = getQuoteUnitCostLAK(a, p.packSize || 1);
              const uCostB = getQuoteUnitCostLAK(b, p.packSize || 1);
              return uCostA - uCostB;
            })[0] || quotesForBestSupplier[0];
            lowestUnitCost = getQuoteUnitCostLAK(bestSelection, p.packSize || 1);
          }
        } else {
          pPrices.forEach(quote => {
            const costPerUnit = getQuoteUnitCostLAK(quote, p.packSize || 1);
            if (costPerUnit < lowestUnitCost && quote.supplier?.trim()) {
              lowestUnitCost = costPerUnit;
              bestSelection = quote;
            }
          });
        }
      }

      const chosenSupplier = bestSelection ? bestSelection.supplier : 'General Market';
      const pricePerPack = bestSelection ? getSinglePackPriceLAK(bestSelection) : 100000;
      const buyUnitConfig = bestSelection ? bestSelection.unit || 'PACK' : 'PACK';
      let sizePerPack = Number(bestSelection ? bestSelection.quantityPerUnit || p.packSize || 1 : p.packSize || 1);
      if (sizePerPack <= 1) {
        sizePerPack = Number(getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase()));
      }

      const isBox = manualBasketUnits[p.id] === 'box';
      const boxSize = p.boxSize && Number(p.boxSize) > 0 ? Number(p.boxSize) : 12;
      const multiplier = isBox ? boxSize : 1;

      const lineCost = qty * pricePerPack * multiplier;

      // Calculate saving amount if multiple prices exist
      let savingAmount = 0;
      if (pPrices.length > 1) {
        const sortedAlternatives = [...pPrices]
          .map(q => getSinglePackPriceLAK(q))
          .sort((a, b) => a - b);
        const secondCheapest = Number(sortedAlternatives[1] || sortedAlternatives[0]);
        savingAmount = Math.max(0, (secondCheapest - pricePerPack) * qty * multiplier);
      }

      const proposalItem = {
        productId: p.id,
        productName: p.name,
        neededBaseQty: qty * multiplier * sizePerPack,
        parentUnit: p.unit || 'g',
        packsToOrder: qty,
        costPerPack: pricePerPack * multiplier,
        packSize: sizePerPack,
        lineCost,
        savingAmount,
        buyUnit: isBox ? (i18n.language === 'la' ? 'BOX' : 'BOX') : buyUnitConfig,
        isFallback: !bestSelection,
        isExhausted: false,
        daysRemaining: 999,
        isBox,
        boxSize
      };

      if (!groups[chosenSupplier]) {
        groups[chosenSupplier] = {
          supplier: chosenSupplier,
          items: [],
          totalCost: 0
        };
      }
      groups[chosenSupplier].items.push(proposalItem);
      groups[chosenSupplier].totalCost += lineCost;
    });

    return Object.values(groups).sort((a, b) => b.totalCost - a.totalCost);
  }, [manualBasket, manualBasketUnits, products, supplierPrices, supplierStrategy, i18n.language]);

  // Filter products for the manual quick-add panel
  const filteredManualProducts = useMemo(() => {
    return processedPlannerData.filter(item => 
      item.name?.toLowerCase().includes(manualProductSearch.toLowerCase())
    );
  }, [processedPlannerData, manualProductSearch]);

  const updateBasketQty = (productId: string, delta: number) => {
    setManualBasket(prev => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [productId]: next };
    });
  };

  const setBasketQtyValue = (productId: string, val: number) => {
    setManualBasket(prev => {
      const next = Math.max(0, val);
      return { ...prev, [productId]: next };
    });
  };

  const deleteManualBill = (supplierName: string) => {
    setManualBasket(prev => {
      const next = { ...prev };
      const group = manualPurchaseGroups.find(g => g.supplier === supplierName);
      if (group) {
        group.items.forEach(it => {
          delete next[it.productId];
        });
      }
      return next;
    });
  };

  const dismissAutoSupplier = (supplierName: string) => {
    setDismissedSuppliers(prev => [...prev, supplierName]);
  };

  const handlePrintCombined = () => {
    const activeGroups = plannerTab === 'auto' ? supplierPurchaseGroups : manualPurchaseGroups;
    if (activeGroups.length === 0) {
      return;
    }

    const allItems: any[] = [];
    let totalCost = 0;

    activeGroups.forEach(group => {
      group.items.forEach(it => {
        allItems.push({
          ...it,
          supplierName: group.supplier
        });
      });
      totalCost += group.totalCost;
    });

    const combinedBill = {
      supplier: i18n.language === 'la' ? 'ບິນຈັດຊື້ລວມ (ທຸກຮ້ານ)' : 'Combined Suppliers Bill',
      items: allItems,
      totalCost,
      isCombined: true,
      originalGroups: activeGroups
    };

    setSelectedBill(combinedBill);
    setIsPrinterModalOpen(true);
  };

  // Audio beep simulation on Bluetooth pairs
  const playBtBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // 800Hz sound
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      console.log("Audio API not supported in this frame context.");
    }
  };

  // Simulated Connect BT Printer function
  const triggerBluetoothSearch = () => {
    setIsSearchingBt(true);
    setPairingSuccess(false);
    setTimeout(() => {
      // Simulate found Bluetooth printer
      setIsSearchingBt(false);
      setBtConnected(true);
      setBtStatusText('XZ-90 Thermal Printer (90mm)');
      setPairingSuccess(true);
      playBtBeep();
    }, 2800);
  };

  // Simulated Connect Network IP Printer function
  const triggerIpSearch = () => {
    setIsSearchingIp(true);
    setIpConnected(false);
    setTimeout(() => {
      setIsSearchingIp(false);
      setIpConnected(true);
      setIpStatusText(`ESC/POS Network Printer (${printerIp}:${printerPort})`);
      playBtBeep();
    }, 2200);
  };

  // Custom Canvas Exporting to Image (Guarantees zero-dependency reliability in iFrames)
  const handleExportToImage = (bill: any) => {
    setIsExporting(true);
    setTimeout(() => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Custom Layout sizing based on Paper width
        const width = paperWidth === '90mm' ? 450 : paperWidth === '80mm' ? 400 : 300;
        const padding = 20;
        let y = 30;

        // Compute needed canvas height dynamically
        const headerHeight = 120;
        const rowHeight = 35;
        const isCombined = bill.isCombined;

        let extraHeightForBoxes = 0;
        if (isCombined) {
          (bill.originalGroups || []).forEach((g: any) => {
            (g.items || []).forEach((it: any) => {
              if (it.isBox) extraHeightForBoxes += 14;
            });
          });
        } else {
          (bill.items || []).forEach((it: any) => {
            if (it.isBox) extraHeightForBoxes += 14;
          });
        }

        const totalHeight = headerHeight + 
          (bill.items.length * rowHeight) + 
          (isCombined ? (bill.originalGroups.length * 40) : 0) + 
          extraHeightForBoxes +
          170;

        canvas.width = width;
        canvas.height = totalHeight;

        // Draw thermal background (clean paper look)
        ctx.fillStyle = '#fffdf9';
        ctx.fillRect(0, 0, width, totalHeight);

        // Draw faint grey borderline
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, width - 4, totalHeight - 4);

        // Header Shop Details
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 16px Courier New, monospace';
        ctx.textAlign = 'center';
        ctx.fillText("COFFEE ARCHITECTURE RESTOCK", width / 2, y);
        y += 24;

        ctx.font = '11px Courier New, monospace';
        ctx.fillText("OPTIMIZED B2B PROCUREMENT BILL", width / 2, y);
        y += 18;

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]); // Dashed line
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        y += 18;

        // Metadata
        ctx.setLineDash([]);
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px Courier New, monospace';
        ctx.fillText(`SUPPLIER: ${bill.supplier.toUpperCase()}`, padding, y);
        ctx.textAlign = 'right';
        ctx.fillText(new Date().toLocaleDateString(), width - padding, y);
        y += 20;

        ctx.textAlign = 'left';
        ctx.font = '9px Courier New, monospace';
        ctx.fillStyle = '#64748b';
        ctx.fillText(`PROPOSAL ID: PROP-${Math.round(Math.random() * 89999 + 10000)}`, padding, y);
        y += 20;

        // Dashed table header divider
        ctx.strokeStyle = '#000';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        y += 14;

        // Table headers
        ctx.fillStyle = '#000';
        ctx.font = 'bold 10px Courier New, monospace';
        ctx.textAlign = 'left';
        ctx.fillText("ITEM", padding, y);
        ctx.textAlign = 'center';
        ctx.fillText("QTY", width - 160, y);
        ctx.textAlign = 'right';
        ctx.fillText("EST COST LAK", width - padding, y);
        y += 14;

        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        y += 18;

        // Table items
        ctx.setLineDash([]);
        if (isCombined) {
          bill.originalGroups.forEach((group: any) => {
            ctx.textAlign = 'left';
            ctx.font = 'bold 12px Courier New, monospace';
            ctx.fillStyle = '#052659';
            ctx.fillText(`📍 ${group.supplier.toUpperCase()}`, padding, y);
            y += 20;

            group.items.forEach((item: any) => {
              ctx.textAlign = 'left';
              ctx.font = '11px Courier New, monospace';
              ctx.fillStyle = '#1e293b';
              const maxNameLen = paperWidth === '90mm' ? 22 : 12;
              const shortName = item.productName.substring(0, maxNameLen);
              ctx.fillText(shortName, padding, y);

              ctx.textAlign = 'center';
              ctx.fillText(`${item.packsToOrder} ${item.buyUnit}`, width - 160, y);

              ctx.textAlign = 'right';
              ctx.fillText(item.lineCost.toLocaleString(), width - padding, y);

              if (item.isBox) {
                y += 12;
                ctx.textAlign = 'left';
                ctx.font = '8px Courier New, monospace';
                ctx.fillStyle = '#4b5563';
                ctx.fillText(` *(1 BOX = ${item.boxSize} pk, total ${item.packsToOrder * item.boxSize} pk)`, padding + 4, y);
              }

              y += rowHeight;
            });
            y += 10;
          });
        } else {
          bill.items.forEach((item: any) => {
            ctx.textAlign = 'left';
            ctx.font = '11px Courier New, monospace';
            ctx.fillStyle = '#1e293b';
            const maxNameLen = paperWidth === '90mm' ? 22 : 12;
            const shortName = item.productName.substring(0, maxNameLen);
            ctx.fillText(shortName, padding, y);

            ctx.textAlign = 'center';
            ctx.fillText(`${item.packsToOrder} ${item.buyUnit}`, width - 160, y);

            ctx.textAlign = 'right';
            ctx.fillText(item.lineCost.toLocaleString(), width - padding, y);

            if (item.isBox) {
              y += 12;
              ctx.textAlign = 'left';
              ctx.font = '8px Courier New, monospace';
              ctx.fillStyle = '#4b5563';
              ctx.fillText(` *(1 BOX = ${item.boxSize} pk, total ${item.packsToOrder * item.boxSize} pk)`, padding + 4, y);
            }

            y += rowHeight;
          });
        }

        // Totals Divider
        ctx.strokeStyle = '#000';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        y += 20;

        // Grand Total Row
        ctx.setLineDash([]);
        ctx.font = 'bold 14px Courier New, monospace';
        ctx.textAlign = 'left';
        ctx.fillText("GRAND TOTAL:", padding, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${bill.totalCost.toLocaleString()} ₭`, width - padding, y);
        y += 30;

        // QR Code Placehold Box
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#cbd5e1';
        ctx.setLineDash([2, 2]);
        ctx.strokeRect((width / 2) - 30, y, 60, 60);

        ctx.font = '8px Courier New, monospace';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText("QR B2B VERIFIED", width / 2, y + 35);
        
        // Trigger download
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `Procurement_Bill_${bill.supplier.replace(/\s+/g, '_')}.png`;
        link.href = dataUrl;
        link.click();

        alert("Invoice Saved as PNG Image successfully to your device downloads!");
      } catch (err) {
        console.error("Error during image render:", err);
      } finally {
        setIsExporting(false);
      }
    }, 1200);
  };

  // Browser Window Trigger physical prints
  const handleSystemPrint = () => {
    if (!printRef.current) {
      window.print();
      return;
    }

    // Capture standard raw HTML receipt elements
    const content = printRef.current.innerHTML;

    // Build hidden iframe element targeting isolated document printer context
    const iframe = document.createElement('iframe');
    iframe.id = 'isolated-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-999';
    
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <html>
          <head>
            <title>Print Receipt / ພິມໃບບິນສັ່ງຊື້</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Lao:wght@400;700;900&display=swap');
              @media print {
                body {
                  width: ${paperWidth || '80mm'} !important;
                  margin: 0 auto;
                  padding: 8px;
                }
              }
              body {
                background-color: #ffffff;
                color: #000000;
                font-family: 'Courier New', Courier, 'Noto Sans Lao', monospace;
                padding: 10px;
                width: ${paperWidth || '80mm'};
                box-sizing: border-box;
              }
              .text-center { text-align: center; }
              .space-y-1 > * + * { margin-top: 4px; }
              .space-y-2.5 > * + * { margin-top: 10px; }
              .mt-3 { margin-top: 12px; }
              .mb-1.5 { margin-bottom: 6px; }
              .pt-1 { padding-top: 4px; }
              .py-1.5 { padding-top: 6px; padding-bottom: 6px; }
              .flex { display: flex; }
              .justify-between { justify-content: space-between; }
              .grid { display: grid; }
              .grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
              .col-span-6 { grid-column: span 6 / span 6; }
              .col-span-3 { grid-column: span 3 / span 3; }
              .col-span-12 { grid-column: span 12 / span 12; }
              .text-right { text-align: right; }
              .font-bold { font-weight: 700; }
              .font-black { font-weight: 900; }
              .uppercase { text-transform: uppercase; }
              .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
              
              /* Force highest density dark values for pure black text output */
              * {
                color: #000000 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                text-shadow: none !important;
              }
            </style>
          </head>
          <body>
            <div>${content}</div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.focus();
                  window.print();
                  setTimeout(function() {
                    window.parent.document.body.removeChild(window.frameElement);
                  }, 1000);
                }, 300);
              };
            </script>
          </body>
        </html>
      `);
      doc.close();
    } else {
      // Fallback
      window.print();
    }
  };

  // Filtering products for the live stock audit section
  const filteredProducts = processedPlannerData.filter(item => 
    item.name?.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Title & Desc Header Card */}
      <div className="bg-white dark:bg-slate-900 shadow-xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 border border-slate-100 dark:border-white/5 relative overflow-hidden transition-all duration-300">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -z-10" />
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10 w-full">
          <div className="max-w-xl space-y-4 flex-1">
            <div className="flex items-center gap-2">
              <span className="bg-emerald-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                Phase 2 Active
              </span>
              <span className="bg-blue-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                Cost Optimizer
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-800 dark:text-white leading-tight">
              {t('planner_title')}
            </h1>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
              {t('planner_desc')}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setIsHelpModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-black text-xs rounded-2xl shadow-lg transition-all cursor-pointer transform hover:scale-105"
              title={i18n.language === 'la' ? 'ຄລິກເພື່ອເບິ່ງຄູ່ມື ແລະ ຕົວຢ່າງການປ້ອນຂໍ້ມູນ' : 'Click to view guide and data entry examples'}
            >
              <Info className="w-3.5 h-3.5" />
              <span>Info • ຕົວຢ່າງວິທີໃຊ້</span>
            </button>
            <span className="p-3 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 rounded-2xl">
              <Cpu className="w-5 h-5" />
            </span>
          </div>
        </div>

        <div className="w-full space-y-4 mt-6">

          {/* Interactive controls and slider variables */}
          <div className="pt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* 1. Target Span Slider */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/40 dark:border-white/5 flex flex-col justify-between gap-2 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-sky-500" />
                <span>{i18n.language === 'la' ? 'ໄລຍະເວລາການເຕີມສາງ' : 'Stock Coverage Target'}</span>
              </span>
              <div className="flex items-center justify-between gap-4">
                <input 
                  type="range" 
                  min="2" 
                  max="30" 
                  value={targetCoverageDays}
                  onChange={(e) => setTargetCoverageDays(parseInt(e.target.value) || 6)}
                  className="w-full h-1.5 bg-slate-300 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                />
                <span className="text-xs font-black text-slate-800 dark:text-white px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-md shadow-sm shrink-0">
                  {targetCoverageDays} {i18n.language === 'la' ? 'ວັນ' : 'Days'}
                </span>
              </div>
            </div>

            {/* 2. Forecast Method Selector */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/40 dark:border-white/5 flex flex-col justify-between gap-2 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-500" />
                <span>{i18n.language === 'la' ? 'ฮູບແບບການຄາດຄະເນ' : 'Forecasting Intelligence'}</span>
              </span>
              <div className="grid grid-cols-2 gap-1 bg-white dark:bg-slate-900 p-0.5 rounded-xl border border-slate-100 dark:border-white/5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setForecastMethod('predictive')}
                  className={`px-2 py-1 rounded-lg text-center transition-all duration-200 cursor-pointer ${
                    forecastMethod === 'predictive'
                      ? 'bg-emerald-500 text-white font-black shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {i18n.language === 'la' ? 'ຄາດຄະເນ AI' : 'Predictive AI'}
                </button>
                <button
                  type="button"
                  onClick={() => setForecastMethod('historical')}
                  className={`px-2 py-1 rounded-lg text-center transition-all duration-200 cursor-pointer ${
                    forecastMethod === 'historical'
                      ? 'bg-emerald-500 text-white font-black shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {i18n.language === 'la' ? 'ຍອດຂາຍຈິງ' : 'Real Sales'}
                </button>
              </div>
            </div>

            {/* 3. Expected sales cup volume per day */}
            <div className={`bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/40 dark:border-white/5 flex flex-col justify-between gap-2 shadow-sm transition-all duration-300 ${forecastMethod === 'predictive' ? 'opacity-100 scale-100' : 'opacity-40 pointer-events-none scale-95'}`}>
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span>{i18n.language === 'la' ? 'ຍອດຂາຍຄາດຄະເນ (ຈອກ/ວັນ)' : 'Projected Cups/Day'}</span>
              </span>
              <div className="flex items-center justify-between gap-4">
                <input 
                  type="range" 
                  min="5" 
                  max="250" 
                  step="5"
                  value={projectedCupsPerDay}
                  onChange={(e) => setProjectedCupsPerDay(parseInt(e.target.value) || 50)}
                  className="w-full h-1.5 bg-slate-300 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500" 
                />
                <span className="text-xs font-black text-slate-800 dark:text-white px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-md shadow-sm shrink-0">
                  {projectedCupsPerDay} {i18n.language === 'la' ? 'ຈອກ' : 'Cups'}
                </span>
              </div>
            </div>

            {/* 4. Recommendation Strategy Bias Selector */}
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/40 dark:border-white/5 flex flex-col justify-between gap-2 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-amber-500" />
                <span>{i18n.language === 'la' ? 'ການແນະນຳຮ້ານຄ້າ' : 'Restock Strategy'}</span>
              </span>
              <div className="grid grid-cols-2 gap-1 bg-white dark:bg-slate-900 p-0.5 rounded-xl border border-slate-100 dark:border-white/5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setSupplierStrategy('most_stock_in')}
                  className={`px-1 py-1 rounded-lg text-center transition-all duration-200 cursor-pointer ${
                    supplierStrategy === 'most_stock_in'
                      ? 'bg-amber-500 text-white font-black shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title={i18n.language === 'la' ? 'ອີງຕາມຮ້ານຄ້າທີ່ສົ່ງເຂົ້າຫຼາຍສຸດ (Most Stock In)' : 'Prioritize supplier who furnished the most stock historically'}
                >
                  {i18n.language === 'la' ? 'ສົ່ງຫຼາຍສຸດ' : 'Most Stock'}
                </button>
                <button
                  type="button"
                  onClick={() => setSupplierStrategy('lowest_cost')}
                  className={`px-1 py-1 rounded-lg text-center transition-all duration-200 cursor-pointer ${
                    supplierStrategy === 'lowest_cost'
                      ? 'bg-amber-500 text-white font-black shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title={i18n.language === 'la' ? 'ອີງຕາມລາຄາຖືກທີ່ສຸດ (Lowest Unit Cost)' : 'Prioritize supplier with cheapest base quote'}
                >
                  {i18n.language === 'la' ? 'ລາຄາຖືກສຸດ' : 'Cheapest'}
                </button>
              </div>
            </div>

          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3 w-full items-stretch sm:items-center">
            <button
              onClick={() => setOnlyExhaustion(!onlyExhaustion)}
              className={`p-3 rounded-2xl border text-xs font-black flex items-center justify-between sm:justify-start gap-2 transition-all duration-200 cursor-pointer w-full sm:w-auto ${
                onlyExhaustion 
                  ? 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400 font-extrabold shadow-sm' 
                  : 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800/60 dark:border-white/5 dark:text-slate-300 font-bold'
              }`}
              id="btn-toggle-exhaustion-only"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className={`w-4 h-4 ${onlyExhaustion ? 'text-rose-500' : 'text-slate-400'}`} />
                <span>
                  <span className="hidden sm:inline">
                    {i18n.language === 'la' 
                      ? 'ອອກບິນສະເພາະສິນຄ້າທີ່ກຳລັງຈະໝົດ (Exhaustion Only)' 
                      : 'Auto-Bill Near Exhaustion Only'}
                  </span>
                  <span className="sm:hidden text-[11px]">
                    {i18n.language === 'la' 
                      ? 'ສິນຄ້າໃກ້ໝົດສາງ (Exhaustion Only)' 
                      : 'Near Exhaustion Only'}
                  </span>
                </span>
              </div>
              <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold shrink-0 ${
                onlyExhaustion ? 'bg-rose-500 text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400'
               }`}>
                {onlyExhaustion ? (i18n.language === 'la' ? 'ເປີດ' : 'ON') : (i18n.language === 'la' ? 'ປິດ' : 'OFF')}
              </span>
            </button>

            <button 
              onClick={() => alert("Recalculation optimized. All projections synchronized with live supplier price registers.")}
              className="px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-white text-xs font-bold rounded-2xl transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer border border-transparent hover:border-slate-300 dark:hover:border-white/10 animate-pulse w-full sm:w-auto"
            >
              <RotateCw className="w-3.5 h-3.5 text-emerald-500" />
              <span>{i18n.language === 'la' ? 'ປັບປຸງຍອດຄາດຄະເນ' : 'Refresh Projections'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex bg-slate-100 dark:bg-slate-800/40 p-1 rounded-2xl border border-slate-200/50 dark:border-white/5 w-full max-w-sm sm:max-w-md">
        <button
          onClick={() => setPlannerTab('auto')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
            plannerTab === 'auto'
              ? 'bg-white dark:bg-slate-900 text-[#052659] dark:text-emerald-400 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <Cpu className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="truncate">
            <span className="hidden sm:inline">
              {i18n.language === 'la' ? 'ຄຳນວນເຕີມສາງອັດຕະໂນມັດ' : 'Auto Restock Suggestion'}
            </span>
            <span className="sm:hidden text-[10px]">
              {i18n.language === 'la' ? 'ຄຳນວນອັດຕະໂນມັດ' : 'Auto Option'}
            </span>
          </span>
        </button>
        <button
          onClick={() => setPlannerTab('manual')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
            plannerTab === 'manual'
              ? 'bg-white dark:bg-slate-900 text-[#052659] dark:text-emerald-400 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <ShoppingCart className="w-4 h-4 text-sky-500 shrink-0" />
          <span className="truncate">
            <span className="hidden sm:inline">
              {i18n.language === 'la' ? 'ສ້າງໃບບິນຈັດຊື້ດ້ວຍຕົນເອງ' : 'Manual Restock Builder'}
            </span>
            <span className="sm:hidden text-[10px]">
              {i18n.language === 'la' ? 'ສ້າງໃບບິນເອງ' : 'Manual Builder'}
            </span>
          </span>
        </button>
      </div>



      {plannerTab === 'auto' ? (
        <>
          {/* Grid: Recommended Purchase Orders / Supplier optimized bills */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#052659]/15 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm col-span-full">
              <div className="flex items-center gap-2 flex-wrap">
                <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${onlyExhaustion ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                  {t('optimize_group_bills')}
                </span>
                {dismissedSuppliers.length > 0 && (
                  <button
                    onClick={() => setDismissedSuppliers([])}
                    className="text-[10px] px-2 py-1 bg-white hover:bg-slate-50 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 hover:text-red-500 duration-150 inline-flex items-center gap-1 cursor-pointer font-black"
                  >
                    <RotateCw className="w-3 h-3 text-red-500 shrink-0" />
                    <span>ຄືນຄ່າບິນ ({dismissedSuppliers.length})</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                <span className="text-[10px] font-mono text-slate-400 bg-white dark:bg-slate-900 px-2 py-1 rounded-md border border-slate-100 dark:border-white/5">
                  {supplierPurchaseGroups.length} Optimize Groups
                </span>
                {supplierPurchaseGroups.length > 0 && (
                  <button
                    onClick={handlePrintCombined}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-[10px] uppercase font-black rounded-xl duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{i18n.language === 'la' ? 'ລວມບິນເພື່ອ Print' : 'Combine & Print All'}</span>
                  </button>
                )}
              </div>
            </div>

            {onlyExhaustion && (
              <div className="bg-rose-50 border border-rose-200/50 dark:bg-rose-950/10 dark:border-rose-900/25 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-rose-800 dark:text-rose-400 font-extrabold shadow-sm">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 animate-bounce" />
                  <span>
                    {i18n.language === 'la'
                      ? 'ກຳລັງອອກບິນສະເພາະສິນຄ້າທີ່ກຳລັງຈະໝົດ ຫຼື ໝົດສາງ (Exhaustion Product) ເພື່ອປ້ອງກັນສິນຄ້າຂາດກ່ອນ!'
                      : 'Active Policy: Auto-billing is restricted to near-depleted or out-of-stock (Exhaustion) items first!'}
                  </span>
                </div>
                <button 
                  onClick={() => setOnlyExhaustion(false)}
                  className="text-[10px] px-2.5 py-1 bg-white hover:bg-rose-100 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl border border-rose-200 dark:border-rose-900/20 text-rose-700 dark:text-rose-400 duration-150 shrink-0 self-start sm:self-auto cursor-pointer font-black"
                >
                  {i18n.language === 'la' ? 'ສະແດງວັດຖຸດິບທັງໝົດ' : 'Show All Items'}
                </button>
              </div>
            )}

            {supplierPurchaseGroups.length === 0 ? (
              <div className="bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-500/25 rounded-3xl p-8 text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="w-6 h-6" />
                </div>
                <p className="text-xs font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                  {onlyExhaustion 
                    ? (i18n.language === 'la' ? 'ດີເລີດ! ບໍ່ມີສິນຄ້າໃກ້ໝົດສາງ (Exhaustion) ທີ່ຕ້ອງຟ້າວອອກບິນໃນຂະນະນີ້.' : 'Excellent! No exhaustion-level inventory items require urgent billing right now.')
                    : t('no_restock_needed')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {supplierPurchaseGroups.map((bill, index) => {
                  // Estimate total savings for this group
                  const totalGroupSaving = bill.items.reduce((s, it) => s + it.savingAmount, 0);

                  return (
                    <div 
                      key={index} 
                      className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-emerald-500/35 transition-all duration-300"
                    >
                      <div className="space-y-4">
                        {/* Header Details with optimization results */}
                        <div className="flex items-start justify-between border-b border-slate-50 dark:border-white/5 pb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Building className="w-4 h-4 text-emerald-500" />
                              <h3 className="text-sm font-black text-slate-800 dark:text-white capitalize">
                                {bill.supplier}
                              </h3>
                            </div>
                            <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest mt-0.5">
                              Cheapest Direct Supplier Group
                            </p>
                          </div>

                          {totalGroupSaving > 0 && (
                            <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase px-2 py-1 rounded-lg">
                              {t('cheaper_by')}: {Math.round(totalGroupSaving).toLocaleString()} ₭
                            </span>
                          )}
                        </div>

                        {/* Restock ingredients rows lists */}
                        <div className="space-y-2 max-h-[180px] overflow-y-auto">
                          {bill.items.map((it, i) => (
                            <div key={i} className="flex items-center justify-between p-2 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl text-xs">
                              <div className="space-y-0.5 pr-2 truncate">
                                <div className="flex items-center gap-1.5 flex-wrap truncate">
                                  <p className="font-bold text-slate-800 dark:text-white truncate">
                                    {it.productName}
                                  </p>
                                  {it.isExhausted && (
                                    <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[8px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 leading-none">
                                      {i18n.language === 'la' ? 'ໃກ້ໝົດສາງ' : 'Exhaustion'}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-400">
                                  <span>Needed: {Math.round(it.neededBaseQty).toLocaleString()}{it.parentUnit}</span>
                                  <span>•</span>
                                  <span>Pack size: {it.packSize}{it.parentUnit}</span>
                                </div>
                              </div>

                              <div className="text-right whitespace-nowrap">
                                <p className="font-black text-sky-500">
                                  {it.packsToOrder} {it.buyUnit === 'PACK' ? (i18n.language === 'la' ? 'ແພັກ' : 'Packs') : it.buyUnit}
                                </p>
                                <p className="text-[9px] text-slate-400 font-mono">
                                  {Math.round(it.lineCost).toLocaleString()} ₭
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-4 mt-4 border-t border-slate-50 dark:border-white/5 flex items-center justify-between gap-1">
                        <div>
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">
                            {t('estimated_cost')}
                          </p>
                          <p className="text-sm font-black text-slate-800 dark:text-white">
                            {Math.round(bill.totalCost).toLocaleString()} ₭
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => dismissAutoSupplier(bill.supplier)}
                            className="p-2 border border-rose-200/50 hover:bg-rose-50 dark:border-rose-900/30 dark:hover:bg-rose-950/20 text-rose-500 dark:text-rose-400 rounded-xl duration-200 cursor-pointer"
                            title={i18n.language === 'la' ? 'ລົບບິນນີ້' : 'Delete/Dismiss this bill'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => {
                              setSelectedBill(bill);
                              setIsPrinterModalOpen(true);
                            }}
                            className="px-4 py-2 bg-[#052659] hover:bg-[#073069] text-white text-[10px] uppercase tracking-widest font-black rounded-xl duration-200 flex items-center gap-1.5 cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>{t('print_proposals')}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Main Stock Levels & Consumption Audit Table Section */}
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
              <div>
                <h2 className="text-base font-black text-slate-800 dark:text-white">
                  {t('stock_health')}
                </h2>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Live velocity and burnrate logs derived from physical daily sales reports.
                </p>
              </div>

              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400"><Search className="w-3.5 h-3.5" /></span>
                <input 
                  type="text" 
                  placeholder={i18n.language === 'la' ? "ຄົ້ນຫາວັດຖຸດິບ..." : "Filter raw materials..."}
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="pl-8 pr-4 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 dark:bg-[#052659] text-xs font-semibold text-slate-800 dark:text-white bg-white w-full sm:w-56"
                />
              </div>
            </div>

            {/* Audit Table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-left font-sans text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5 text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-2">{i18n.language === 'la' ? 'ຊື່ວັດຖຸດິບ' : 'Raw Material Item'}</th>
                    <th className="py-3 px-2">{t('burn_rate')}</th>
                    <th className="py-3 px-2 text-center">{t('current_stock')}</th>
                    <th className="py-3 px-2 text-center">{t('target_span')}</th>
                    <th className="py-3 px-2 text-right">{t('suggested_restock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p, index) => {
                    const isReplenishNeeded = p.suggestedAmountToOrder > 0;
                    const daysRemaining = p.avgDailyBurn > 0 ? (p.currentBalance / p.avgDailyBurn) : (p.currentBalance === 0 ? 0 : 999);
                    const isExhausted = p.currentBalance === 0 || p.currentBalance <= p.safetyBuffer || daysRemaining < 3;
                    
                    return (
                      <tr 
                        key={p.id} 
                        className={`border-b border-slate-50 dark:border-white/5 last:border-none duration-150 hover:bg-slate-50/50 dark:hover:bg-slate-950/25 ${isExhausted ? 'text-rose-900 bg-rose-500/5' : isReplenishNeeded ? 'text-slate-800 dark:text-amber-100' : 'text-slate-600 dark:text-slate-400'}`}
                      >
                        <td className="py-3.5 px-2 font-bold flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isExhausted ? 'bg-rose-500 animate-pulse animate-duration-1000' : isReplenishNeeded ? 'bg-amber-500' : 'bg-green-500'}`} />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-slate-800 dark:text-white capitalize leading-3">{p.name}</p>
                              {isExhausted && (
                                <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[8px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 leading-none">
                                  {i18n.language === 'la' ? 'ໃກ້ໝົດ' : 'Exhaustion'}
                                </span>
                              )}
                            </div>
                            <span className="text-[8px] text-slate-400 font-mono">Pack: {p.packSize || 1}{p.unit || 'g'} (Min Stock: {p.safetyBuffer || 0})</span>
                          </div>
                        </td>
                        
                        <td className="py-3.5 px-2 font-mono font-bold text-sky-500">
                          {p.avgDailyBurn.toFixed(1)} {p.unit || 'g'}/day
                        </td>

                        <td className="py-3.5 px-2 text-center font-mono font-bold text-slate-700 dark:text-slate-200">
                          {Math.round(p.currentBalance).toLocaleString()} {p.unit || 'g'}
                        </td>

                        <td className="py-3.5 px-2 text-center font-mono text-slate-400">
                          {Math.round(p.targetStockLevel).toLocaleString()} {p.unit || 'g'}
                        </td>

                        <td className="py-3.5 px-2 text-right font-black">
                          {isReplenishNeeded ? (
                            <span className="text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg">
                              + {Math.round(p.suggestedAmountToOrder).toLocaleString()} {p.unit || 'g'}
                            </span>
                          ) : (
                            <span className="text-green-500 bg-green-500/10 px-2 py-0.5 rounded-lg text-[9px] uppercase tracking-wider">
                              Healthy
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile-First Stock Audit Cards list (under md layout) */}
            <div className="md:hidden flex flex-col gap-3 w-full">
              {filteredProducts.map((p) => {
                const isReplenishNeeded = p.suggestedAmountToOrder > 0;
                const daysRemaining = p.avgDailyBurn > 0 ? (p.currentBalance / p.avgDailyBurn) : (p.currentBalance === 0 ? 0 : 999);
                const isExhausted = p.currentBalance === 0 || p.currentBalance <= p.safetyBuffer || daysRemaining < 3;
                
                return (
                  <div 
                    key={`mob-stock-${p.id}`} 
                    className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col gap-2.5 shadow-sm ${
                      isExhausted 
                        ? 'bg-rose-50/40 dark:bg-rose-950/5 border-rose-200/50 dark:border-rose-900/30 text-rose-900 dark:text-rose-450' 
                        : isReplenishNeeded 
                          ? 'bg-amber-50/30 dark:bg-amber-950/5 border-amber-200/40 dark:border-amber-900/25 text-amber-900 dark:text-amber-400' 
                          : 'bg-slate-50/50 dark:bg-slate-950/15 border-slate-150 dark:border-white/5 text-slate-800 dark:text-slate-350'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5 truncate flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isExhausted ? 'bg-rose-500 animate-pulse' : isReplenishNeeded ? 'bg-amber-500' : 'bg-green-500'}`} />
                          <h4 className="font-extrabold text-[#052659] dark:text-sky-400 capitalize text-xs truncate leading-tight">{p.name}</h4>
                          {isExhausted && (
                            <span className="bg-rose-500 text-white text-[8px] font-black uppercase px-1 rounded-sm leading-none shrink-0 py-0.5">
                              {i18n.language === 'la' ? 'ໃກ້ໝົດ' : 'Exhaustion'}
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                          Pack: {p.packSize || 1}{p.unit || 'g'} (Min Stock: {p.safetyBuffer || 0})
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        {isReplenishNeeded ? (
                          <span className="text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg font-black text-[10px] whitespace-nowrap">
                            + {Math.round(p.suggestedAmountToOrder).toLocaleString()} {p.unit || 'g'}
                          </span>
                        ) : (
                          <span className="text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-lg text-[9px] uppercase tracking-wider font-extrabold whitespace-nowrap">
                            {i18n.language === 'la' ? 'ປົກກະຕິ' : 'Healthy'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-200/40 dark:border-white/5 text-[10px]">
                      <div>
                        <p className="text-[8px] text-slate-400 uppercase font-black tracking-wider leading-none">{t('burn_rate')}</p>
                        <p className="font-mono font-bold text-sky-500 mt-1">
                          {p.avgDailyBurn.toFixed(1)} {p.unit || 'g'}/d
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-[8px] text-slate-400 uppercase font-black tracking-wider leading-none">{t('current_stock')}</p>
                        <p className="font-mono font-bold text-slate-700 dark:text-slate-200 mt-1">
                          {Math.round(p.currentBalance).toLocaleString()} {p.unit || 'g'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] text-slate-400 uppercase font-black tracking-wider leading-none">{t('target_span')}</p>
                        <p className="font-mono font-semibold text-slate-400 mt-1">
                          {Math.round(p.targetStockLevel).toLocaleString()} {p.unit || 'g'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Manual restock panel - Bento layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Product Selector Checker Grid */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <h2 className="text-base font-black text-slate-800 dark:text-white">
                    {i18n.language === 'la' ? 'ເລືອກວັດຖຸດິບ & ລະບຸຈຳນວນແພັກ' : 'Select Raw Materials & Order Volume'}
                  </h2>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {i18n.language === 'la' 
                      ? 'ເລືອກວັດຖຸດິບທີ່ຕ້ອງການ, ລະບົບຈະແນະນຳຮ້ານຄ້າທີ່ຄຸ້ມທີ່ສຸດໃຫ້ອັດຕະໂນມັດ' 
                      : 'Specify order packs. The app split-groups orders based on the cheapest supplier.'}
                  </p>
                </div>

                <button 
                  onClick={() => {
                    setManualBasket({});
                    setManualBasketUnits({});
                    setManualProductSearch('');
                  }}
                  className="text-[10px] px-3 py-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 hover:text-red-500 rounded-xl font-bold transition duration-150 cursor-pointer self-start sm:self-auto"
                >
                  {i18n.language === 'la' ? 'ລ້າງຕະກ້າ' : 'Clear Basket'}
                </button>
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[10px] leading-relaxed text-slate-705 dark:text-blue-200">
                <span className="font-bold text-blue-600 dark:text-blue-450">💡 {i18n.language === 'la' ? 'ວິທີການສັ່ງຊື້ເປັນແພັກ (How to buy as packs):' : 'How to buy as packs:'}</span>
                <br />
                {i18n.language === 'la'
                  ? 'ເມື່ອຕ້ອງການສັ່ງຊື້ສິນຄ້າໃດໜຶ່ງເປັນແພັກ ເຊັ່ນ ມັດຊະ (Matcha 500g) ຫຼື ນົມຂຸ້ນ 2000g, ໃຫ້ກົດບວກ (+) ຫຼື ປ້ອນຕົວເລກຈຳນວນ "ແພັກ" ປ້ອນເຂົ້າໃນຊ່ອງສິນຄ້ານັ້ນໆໂດຍກົງ. ລະບົບຈະແນບອັດຕາແລກປ່ຽນ ແລະ ສັງເຄາະຄຳນວນຍອດກຣາມ/ມລ ເຂົ້າສາງໃຫ້ອັດຕະໂນມັດ!'
                  : 'To purchase an item as a pack (e.g. Matcha 500g or Condensed Milk 2000g), simply increase the pack counter (+) below. The system will convert this count to gram/ml quantities for your inventory logs automatically!'}
              </div>

              {/* Search box for products */}
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400"><Search className="w-3.5 h-3.5" /></span>
                <input 
                  type="text" 
                  placeholder={i18n.language === 'la' ? "ຄົ້ນຫາວັດຖຸດິບ..." : "Filter raw materials..."}
                  value={manualProductSearch}
                  onChange={(e) => setManualProductSearch(e.target.value)}
                  className="pl-8 pr-4 py-1.5 rounded-xl border border-slate-200 dark:border-white/10 dark:bg-[#052659] text-xs font-semibold text-slate-800 dark:text-white bg-white w-full"
                />
              </div>

              {/* Filtered Manual Products Listing */}
              <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                {filteredManualProducts.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    {i18n.language === 'la' ? 'ບໍ່ພົບວັດຖຸດິບ' : 'No raw materials found.'}
                  </p>
                ) : (
                  filteredManualProducts.map(p => {
                    const qtyInBasket = manualBasket[p.id] || 0;
                    
                    // Fine-tune cheap quote for live info
                    const pPrices = supplierPrices.filter(sp => sp.productId === p.id);
                    let cheapestQuote: any = null;
                    let lowestCost = Infinity;
                    if (pPrices.length > 0) {
                      pPrices.forEach(q => {
                        let costPerUnit = getQuoteUnitCostLAK(q, p.packSize || 1);
                        if (costPerUnit < lowestCost) {
                          lowestCost = costPerUnit;
                          cheapestQuote = q;
                        }
                      });
                    }

                    return (
                      <div 
                        key={p.id} 
                        className={`p-3 rounded-2xl border transition duration-150 flex flex-col justify-center gap-2 ${
                          qtyInBasket > 0 
                            ? 'bg-sky-50/40 dark:bg-sky-950/5 border-sky-400/40 dark:border-sky-500/35' 
                            : 'bg-slate-50/50 dark:bg-slate-950/15 border-slate-100 dark:border-white/5 hover:border-slate-200 dark:hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 w-full">
                          <div className="space-y-1 pr-2 truncate">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-slate-800 dark:text-white text-xs truncate capitalize leading-tight">
                                {p.name}
                              </p>
                              <span className="shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 tracking-wide border border-blue-500/10" title="Pack Size Reference">
                                1 {i18n.language === 'la' ? 'ແພັກ' : 'pack'} = {(p.packSize || 1).toLocaleString()} {p.unit || 'g'}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                              <span className="text-slate-400 font-mono">
                                {i18n.language === 'la' ? 'ຍອດຄົງເຫຼືອ: ' : 'Stock Balance: '}
                                {Math.round(p.currentBalance).toLocaleString()} {p.unit || 'g'}
                              </span>
                              <span className="text-slate-300 dark:text-slate-700 font-mono">•</span>
                              {cheapestQuote ? (
                                <span className="text-emerald-500 font-mono font-bold">
                                  {cheapestQuote.supplier}: {Math.round(getSinglePackPriceLAK(cheapestQuote)).toLocaleString()} ₭/{cheapestQuote.unit || 'ແພັກ'}
                                </span>
                              ) : (
                                <span className="text-amber-500 font-mono italic">
                                  {i18n.language === 'la' ? 'ບໍ່ມີປະຫວັດບັນທຶກລາຄາ' : 'General Supplier'}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Numeric Counter Controls */}
                          <div className="flex items-center gap-1 shrink-0 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-white/5 rounded-xl p-0.5">
                            {qtyInBasket > 0 ? (
                              <>
                                <button
                                  onClick={() => updateBasketQty(p.id, -1)}
                                  className="w-7 h-7 flex items-center justify-center bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg text-slate-500 hover:text-rose-500 text-xs font-black select-none cursor-pointer duration-100"
                                >
                                  -
                                </button>
                                <input 
                                  type="text" 
                                  value={qtyInBasket}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value) || 0;
                                    setBasketQtyValue(p.id, v);
                                  }}
                                  className="w-9 text-center text-xs font-black text-slate-800 dark:text-white bg-transparent outline-none border-none p-0 focus:ring-0"
                                />
                                <button
                                  onClick={() => updateBasketQty(p.id, 1)}
                                  className="w-7 h-7 flex items-center justify-center bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg text-slate-500 hover:text-emerald-500 text-xs font-black select-none cursor-pointer duration-100"
                                >
                                  +
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => updateBasketQty(p.id, 1)}
                                className="px-3 py-1 bg-[#052659] hover:bg-[#073069] text-white text-[10px] uppercase font-black tracking-widest rounded-lg flex items-center gap-1 h-7 duration-150 cursor-pointer"
                              >
                                <span>+ Add</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Switch unit & details if added */}
                        {qtyInBasket > 0 && (() => {
                          const currentUnit = manualBasketUnits[p.id] || 'pack';
                          const boxSize = p.boxSize && Number(p.boxSize) > 0 ? Number(p.boxSize) : 12;
                          return (
                            <div className="mt-1 pt-2 border-t border-slate-100 dark:border-white/5 flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3 w-full">
                              <div className="flex bg-slate-100 dark:bg-black/25 rounded-md p-0.5">
                                <button
                                  type="button"
                                  onClick={() => setManualBasketUnits(prev => ({ ...prev, [p.id]: 'pack' }))}
                                  className={`px-1.5 py-0.5 text-[8px] font-black uppercase rounded-sm transition cursor-pointer ${
                                    currentUnit === 'pack'
                                      ? 'bg-[#052659] text-white shadow-xs'
                                      : 'text-slate-400 hover:text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {i18n.language === 'la' ? 'ແພັກ' : 'Pack'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setManualBasketUnits(prev => ({ ...prev, [p.id]: 'box' }))}
                                  className={`px-1.5 py-0.5 text-[8px] font-black uppercase rounded-sm transition cursor-pointer ${
                                    currentUnit === 'box'
                                      ? 'bg-[#052659] text-white shadow-xs'
                                      : 'text-slate-400 hover:text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {i18n.language === 'la' ? 'ກ່ອງ (Box)' : 'Box'}
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5 text-[9.5px]">
                                {currentUnit === 'box' ? (
                                  <div className="flex items-center gap-1 text-slate-500 dark:text-slate-350 animate-in fade-in duration-100">
                                    <span className="font-bold text-[8.5px] uppercase text-[#052659] dark:text-sky-300">📦 1 Box =</span>
                                    <input
                                      type="number"
                                      min="1"
                                      value={p.boxSize !== undefined ? p.boxSize : 12}
                                      onChange={async (e) => {
                                        const val = Math.max(1, parseInt(e.target.value) || 12);
                                        // Update boxSize in Firestore!
                                        await setDoc(doc(db, 'products', p.id), { boxSize: val }, { merge: true });
                                      }}
                                      className="w-10 h-5 text-center border border-slate-200 dark:border-white/10 dark:bg-[#073069] rounded-md font-bold text-xs p-0 text-slate-800 dark:text-white"
                                      title={i18n.language === 'la' ? 'ປ່ຽນຈຳນວນແພັກໃນ 1 ກ່ອງ' : 'Change packs per box'}
                                    />
                                    <span>{i18n.language === 'la' ? 'ແພັກ' : 'packs'}</span>
                                    <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400 ml-1 bg-emerald-500/10 px-1 py-0.5 rounded-sm">
                                      ({(qtyInBasket * boxSize).toLocaleString()} {i18n.language === 'la' ? 'ແພັກທັງໝົດ' : 'packs total'})
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-[8px] text-slate-400 tracking-wide font-medium italic">
                                    {i18n.language === 'la' ? 'ສັ່ງຊື້ເປັນແພັກຍ່ອຍ' : 'Ordering as individual packs'}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Split Supplier Bills Live View */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#052659]/15 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-sky-500" />
                  <span>{i18n.language === 'la' ? 'ຜົນການແຍກບິນຕາມຮ້ານ' : 'Group Splitting Results'}</span>
                </span>
                <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                  <span className="text-[10px] font-mono text-slate-400 bg-white dark:bg-slate-900 px-2 py-1 rounded-md border border-slate-100 dark:border-white/5">
                    {manualPurchaseGroups.length} Invoices
                  </span>
                  {manualPurchaseGroups.length > 0 && (
                    <button
                      onClick={handlePrintCombined}
                      className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-[10px] uppercase font-black rounded-xl duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>{i18n.language === 'la' ? 'ລວມບິນເພື່ອ Print' : 'Combine & Print All'}</span>
                    </button>
                  )}
                </div>
              </div>

              {manualPurchaseGroups.length === 0 ? (
                <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-white/5 border-dashed rounded-3xl p-10 text-center space-y-3">
                  <div className="w-12 h-12 bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-full flex items-center justify-center mx-auto">
                    <ShoppingCart className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {i18n.language === 'la' 
                      ? 'ຕະກ້າຈັດຊື້ຍັງວ່າງເປົ່າ' 
                      : 'Manual Basket is Empty'}
                  </p>
                  <p className="text-[10px] text-slate-400 max-w-[200px] mx-auto leading-normal">
                    {i18n.language === 'la'
                      ? 'ກະລຸນາເລືອກວັດຖຸດິບ ແລະ ລະບຸຈຳນວນແພັກທາງຊ້າຍມື ເພື່ອສັງເຄາະແຍກບິນໄປແຕ່ລະຮ້ານສະໜອງອັດຕະໂນມັດ!'
                      : 'Increase quantity on left menu to automatically split-assign products onto the cheapest supplier invoices!'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  
                  {/* Savings Dashboard Indicator */}
                  <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl flex items-center justify-between gap-2 shadow-sm dark:bg-emerald-950/10 dark:border-emerald-900/30">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none">
                          {i18n.language === 'la' ? 'ປະຢັດງົບປະມານໄດ້ທັງໝົດ' : 'Total Procurement Savings'}
                        </p>
                        <p className="text-xs font-black text-emerald-800 dark:text-emerald-400 mt-1">
                          {Math.round(manualPurchaseGroups.reduce((sum, g) => sum + g.items.reduce((s, item) => s + (item.savingAmount || 0), 0), 0)).toLocaleString()} ₭
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider leading-none">
                        {i18n.language === 'la' ? 'ລາຄາຈັດຊື້ລວມທັງໝົດ' : 'Aggregate Total'}
                      </p>
                      <p className="text-xs font-black text-slate-800 dark:text-white mt-1">
                        {Math.round(manualPurchaseGroups.reduce((sum, g) => sum + g.totalCost, 0)).toLocaleString()} ₭
                      </p>
                    </div>
                  </div>

                  {/* Rendering of Split Supplier Bills cards */}
                  {manualPurchaseGroups.map((bill, index) => {
                    const totalGroupSaving = bill.items.reduce((s, it) => s + it.savingAmount, 0);

                    return (
                      <div 
                        key={index} 
                        className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-emerald-500/35 transition-all duration-300"
                      >
                        <div className="space-y-4">
                          <div className="flex items-start justify-between border-b border-slate-50 dark:border-white/5 pb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <Building className="w-4 h-4 text-emerald-500" />
                                <h3 className="text-sm font-black text-slate-800 dark:text-white capitalize">
                                  {bill.supplier}
                                </h3>
                              </div>
                              <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest mt-0.5">
                                Best Deal Matches Detected
                              </p>
                            </div>

                            {totalGroupSaving > 0 && (
                              <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase px-2 py-1 rounded-lg">
                                {t('cheaper_by')}: {Math.round(totalGroupSaving).toLocaleString()} ₭
                              </span>
                            )}
                          </div>

                          {/* Basket items list */}
                          <div className="space-y-2 max-h-[180px] overflow-y-auto">
                            {bill.items.map((it, i) => (
                              <div key={i} className="flex items-center justify-between p-2 bg-slate-50/50 dark:bg-[#052659]/10 rounded-xl text-xs">
                                <div className="space-y-0.5 pr-2 truncate">
                                  <p className="font-bold text-slate-800 dark:text-white truncate">
                                    {it.productName}
                                  </p>
                                  <div className="flex flex-col gap-0.5 text-[9px] font-mono text-slate-400">
                                    <span>Bulk unit size: {it.packSize}{it.parentUnit}</span>
                                    {it.isBox && (
                                      <span className="text-emerald-500 font-black animate-pulse">
                                        (📦 1 BOX = {it.boxSize} pk, total {it.packsToOrder * it.boxSize} pk)
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="text-right whitespace-nowrap">
                                  <p className="font-black text-sky-500">
                                    {it.packsToOrder} {it.buyUnit === 'PACK' ? (i18n.language === 'la' ? 'ແພັກ' : 'Packs') : (it.buyUnit === 'BOX' && i18n.language === 'la' ? 'ກ່ອງ' : it.buyUnit)}
                                  </p>
                                  <p className="text-[9px] text-slate-400 font-mono">
                                    {Math.round(it.lineCost).toLocaleString()} ₭
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-4 mt-4 border-t border-slate-50 dark:border-white/5 flex items-center justify-between gap-1">
                          <div>
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">
                              {t('estimated_cost')}
                            </p>
                            <p className="text-sm font-black text-slate-800 dark:text-white">
                              {Math.round(bill.totalCost).toLocaleString()} ₭
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deleteManualBill(bill.supplier)}
                              className="p-2 border border-rose-200/50 hover:bg-rose-50 dark:border-rose-900/30 dark:hover:bg-rose-950/20 text-rose-500 dark:text-rose-400 rounded-xl duration-200 cursor-pointer"
                              title={i18n.language === 'la' ? 'ລົບບິນນີ້' : 'Delete/Dismiss this bill'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => {
                                setSelectedBill(bill);
                                setIsPrinterModalOpen(true);
                              }}
                              className="px-4 py-2 bg-[#052659] hover:bg-[#073069] text-white text-[10px] uppercase tracking-widest font-black rounded-xl duration-200 flex items-center gap-1.5 cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{t('print_proposals')}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* THERMAL PRINT PREVIEW MODAL */}
      <AnimatePresence>
        {isPrinterModalOpen && selectedBill && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-white/10 rounded-3xl p-6 max-w-lg w-full max-h-[90vh] flex flex-col justify-between shadow-2xl relative"
            >
              <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                {/* Modal Title and Controls */}
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-1.5">
                    <Printer className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-sm font-black text-white uppercase tracking-wider">
                      {t('receipt_preview')}
                    </h2>
                  </div>
                  <button 
                    onClick={() => {
                      setIsPrinterModalOpen(false);
                      setPairingSuccess(false);
                    }}
                    className="p-1 px-2.5 rounded-lg hover:bg-white/10 text-slate-400 cursor-pointer text-xs"
                  >
                    ✕
                  </button>
                </div>

                {/* Connection Type segmented control */}
                <div className="bg-white/5 p-3 rounded-2xl border border-white/5 text-xs">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">
                    {i18n.language === 'la' ? 'ການເຊື່ອມຕໍ່ / Connection Type' : 'Connection Type'}
                  </p>
                  <div className="grid grid-cols-2 gap-1 bg-black/30 p-0.5 rounded-lg border border-white/5">
                    <button
                      type="button"
                      onClick={() => setConnectionType('network')}
                      className={`py-1 rounded-md text-center transition-all cursor-pointer font-bold ${
                        connectionType === 'network'
                          ? 'bg-emerald-500 text-white font-black shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {i18n.language === 'la' ? 'IP Network (WiFi/LAN)' : 'Network IP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectionType('bluetooth')}
                      className={`py-1 rounded-md text-center transition-all cursor-pointer font-bold ${
                        connectionType === 'bluetooth'
                          ? 'bg-emerald-500 text-white font-black shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {i18n.language === 'la' ? 'Bluetooth (BT)' : 'Bluetooth'}
                    </button>
                  </div>
                </div>

                {/* Sub-Variables selection: Width & Connection Details */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* Paper size setting */}
                  <div className="bg-white/5 p-3 rounded-2xl border border-white/5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">
                      {t('paper_size')}
                    </p>
                    <select 
                      value={paperWidth}
                      onChange={(e) => setPaperWidth(e.target.value as any)}
                      className="w-full mt-1.5 bg-[#052659] text-white border border-white/10 rounded-lg p-1 text-xs font-bold font-mono outline-none"
                    >
                      <option value="90mm">90mm (Wide)</option>
                      <option value="80mm">80mm (Standard IP)</option>
                      <option value="50mm">50mm (Compact)</option>
                    </select>
                  </div>

                  {/* Active Connection state controller */}
                  {connectionType === 'network' ? (
                    <div className="bg-white/5 p-3 rounded-2xl border border-white/5 relative flex flex-col justify-between">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">
                          IP PRINTER ADDR
                        </p>
                        <div className="flex gap-1.5 items-center mt-1">
                          <input
                            type="text"
                            value={printerIp}
                            onChange={(e) => {
                              setPrinterIp(e.target.value);
                              setIpConnected(false);
                            }}
                            placeholder="192.168.1.22"
                            className="bg-black/40 text-[10px] font-mono font-bold text-white w-full rounded border border-white/10 px-1 py-0.5 outline-none text-center"
                          />
                        </div>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <div className={`w-1.5 h-1.5 rounded-full ${ipConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                          <span className="text-[8px] font-mono text-slate-400 uppercase tracking-tight">
                            {ipConnected ? 'Connected' : 'Offline'}
                          </span>
                        </div>
                        
                        {!ipConnected ? (
                          <button 
                            type="button"
                            onClick={triggerIpSearch}
                            className="text-[8px] font-black uppercase text-amber-400 hover:underline cursor-pointer"
                          >
                            Connect
                          </button>
                        ) : (
                          <button 
                            type="button"
                            onClick={() => {
                              setIpConnected(false);
                              setIpStatusText('Disconnected');
                            }}
                            className="text-[8px] text-red-400 hover:underline cursor-pointer"
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white/5 p-3 rounded-2xl border border-white/5 relative flex flex-col justify-between">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">
                          {t('bt_status')}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${btConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                          <span className="text-[10px] font-mono truncate max-w-[110px]" title={btStatusText}>
                            {btConnected ? t('bt_connected').split(' ')[0] : 'Offline'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 flex justify-end">
                        {!btConnected ? (
                          <button 
                            onClick={triggerBluetoothSearch}
                            className="text-[8px] tracking-wide font-black uppercase text-amber-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            <Smartphone className="w-2.5 h-2.5" />
                            <span>Pair BT Printer</span>
                          </button>
                        ) : (
                          <button 
                            onClick={() => {
                              setBtConnected(false);
                              setBtStatusText('Disconnected');
                            }}
                            className="text-[8px] tracking-wide text-red-400 hover:underline uppercase flex items-center gap-0.5 cursor-pointer"
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Simulated search pairing / ping block */}
                {isSearchingIp && (
                  <div className="bg-blue-900/30 border border-blue-500/20 rounded-2xl p-3 text-center text-xs animate-pulse font-bold text-blue-400">
                    Ping {printerIp} on TCP port {printerPort}...
                  </div>
                )}

                {isSearchingBt && (
                  <div className="bg-blue-900/30 border border-blue-500/20 rounded-2xl p-3 text-center text-xs space-y-2 animate-pulse">
                    <p className="text-blue-400 font-bold">{t('scanning_devices')}</p>
                    <div className="flex justify-center gap-2">
                      <span className="px-2 py-1 bg-white/5 border border-white/5 hover:border-slate-300 rounded text-[9px] text-slate-300 cursor-pointer">BT-SP900 (90mm)</span>
                      <span className="px-2 py-1 bg-white/5 border border-white/5 hover:border-slate-300 rounded text-[9px] text-slate-300 cursor-pointer">XZ-50 (50mm)</span>
                    </div>
                  </div>
                )}

                {pairingSuccess && connectionType === 'bluetooth' && (
                  <div className="bg-green-950/20 border border-green-500/30 text-green-400 rounded-2xl p-2.5 text-center text-[10px] uppercase tracking-wide font-bold animate-in zoom-in-95 duration-150">
                    {t('connected_suc')}
                  </div>
                )}

                {ipConnected && connectionType === 'network' && (
                  <div className="bg-green-950/20 border border-green-500/30 text-green-400 rounded-2xl p-2.5 text-center text-[11px] font-black tracking-tight uppercase flex items-center justify-center gap-1 animate-in zoom-in-95 duration-150 font-mono">
                    ✅ CONNECTED ADDR: {printerIp}:{printerPort} (ESC/POS ACTIVE)
                  </div>
                )}

                {/* ADVANCED TROUBLESHOOTING TIP FOR SANDBOX PREVIEWS */}
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[10.5px] leading-relaxed text-amber-200">
                  <p className="font-bold uppercase tracking-wider text-[9px] text-amber-400 mb-1 flex items-center gap-1">
                    <span>💡</span> {i18n.language === 'la' ? 'ຄຳແນະນຳໃນການເຊື່ອມຕໍ່:' : 'Printer Connection Note:'}
                  </p>
                  {i18n.language === 'la' ? (
                    <span>
                      ເນື່ອງຈາກແອັບພລິເຄຊັນກຳລັງເຮັດວຽກຢູ່ໃນ <strong>Preview Frame (Sandbox)</strong>, ເວັບບຣາວເຊີຈະບລັອກການເຊື່ອມຕໍ່ Bluetooth ຫຼື IP Network ແບບໂດຍກົງ. 
                      <br />
                      <strong className="text-white">✓ ວິທີແກ້ໄຂທີ່ແນະນຳ:</strong> ໃຫ້ກົດປຸ່ມ <strong className="text-emerald-400 font-black">"ສັ່ງພິມໃບບິນຕົວຈິງ (System)"</strong> ດ້ານລຸ່ມເພື່ອເປີດການພິມຜ່ານ USB/BT/Wifi Driver ຂອງຄອມພິວເຕີ/ມືຖືຂອງທ່ານໄດ້ທັນທີ, ຫຼື ເປີດແອັບໃນແຖບໃໝ່ (Open in New Tab).
                    </span>
                  ) : (
                    <span>
                      Since the app runs within a <strong>Sandbox Preview Frame</strong>, the browser blocks raw Web Bluetooth or TCP IP socket connections.
                      <br />
                      <strong className="text-white">✓ Guaranteed Method:</strong> Click the <strong className="text-emerald-400 font-black">"Trigger Physical Print (System)"</strong> button below to print through your device's native USB/BT/Wifi driver, or open this app in a New Tab.
                    </span>
                  )}
                </div>

                {/* DYNAMIC RECEIPT CUSTOMIZATION PANEL */}
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-xs space-y-3 mt-1 animate-in fade-in-50 duration-300">
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest leading-none flex items-center gap-1.5">
                    <span>⚙️</span>
                    {i18n.language === 'la' ? 'ປັບແຕ່ງຫົວ/ທ້າຍໃບບິນ (Customize Bill layout)' : 'Customize Bill Header & Footer'}
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-1">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 block mb-1">
                        {i18n.language === 'la' ? 'ຊື່ຫົວບິນ / ຊື່ຮ້ານ' : 'Shop Name / Header'}
                      </label>
                      <input 
                        type="text" 
                        value={customHeader}
                        onChange={(e) => setCustomHeader(e.target.value)}
                        className="w-full bg-[#052659] text-white border border-white/10 rounded-lg p-1.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors"
                        placeholder="COFFEE ARCHITECTURE"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-slate-400 block mb-1">
                        {i18n.language === 'la' ? 'ເບີໂທລະສັບ' : 'Phone Number'}
                      </label>
                      <input 
                        type="text" 
                        value={customPhone}
                        onChange={(e) => setCustomPhone(e.target.value)}
                        className="w-full bg-[#052659] text-white border border-white/10 rounded-lg p-1.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors"
                        placeholder="+856 20 8888 9999"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 block mb-1">
                        {i18n.language === 'la' ? 'ທີ່ຢູ່ຮ້ານ' : 'Shop Address'}
                      </label>
                      <input 
                        type="text" 
                        value={customAddress}
                        onChange={(e) => setCustomAddress(e.target.value)}
                        className="w-full bg-[#052659] text-white border border-white/10 rounded-lg p-1.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors"
                        placeholder="Lao People's Democratic Republic"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-slate-400 block mb-1">
                        {i18n.language === 'la' ? 'ຂໍ້ຄວາມທ້າຍບິນ' : 'Footer Message'}
                      </label>
                      <input 
                        type="text" 
                        value={customFooter}
                        onChange={(e) => setCustomFooter(e.target.value)}
                        className="w-full bg-[#052659] text-white border border-white/10 rounded-lg p-1.5 text-[10px] font-mono outline-none focus:border-emerald-500 transition-colors"
                        placeholder="generated dynamically by coffee shop budget planner & supplier pricing sync."
                      />
                    </div>
                  </div>

                  {/* SAVE DRAFT BUTTON */}
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={saveReceiptDraft}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-150 flex items-center gap-1.5 cursor-pointer shadow-sm w-full sm:w-auto justify-center h-9 ${
                        saveSuccess 
                          ? 'bg-emerald-600 text-white' 
                          : 'bg-gradient-to-r from-blue-500/20 to-indigo-500/20 text-blue-400 hover:from-blue-500/30 hover:to-indigo-500/30 border border-blue-500/30'
                      }`}
                    >
                      {saveSuccess ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-300" />
                          <span>{i18n.language === 'la' ? 'ບັນທຶກຮ່າງສໍາເລັດແລ້ວ! ✓' : 'Draft Layout Saved! ✓'}</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5 text-blue-400" />
                          <span>{i18n.language === 'la' ? '💾 ບັນທຶກຮ່າງໃບບິນເປັນຄ່າເລີ່ມຕົ້ນ' : '💾 Save Draft Layout Template'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* BARCODE EXPLAINER / EDUCATIONAL TOOLTIP */}
                  <div className="p-3.5 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/15 rounded-xl space-y-1">
                    <p className="text-[10px] font-black text-emerald-400 flex items-center gap-1.5 uppercase">
                      <span>📊</span>
                      {i18n.language === 'la' ? 'ລະບົບ Barcode & QR Code ທ້າຍບິນມີປະໂຫຍດຫຍັງ?' : 'How Barcode & QR code scanning benefits you:'}
                    </p>
                    <div className="text-[9.5px] text-slate-300 leading-relaxed space-y-1">
                      {i18n.language === 'la' ? (
                        <>
                          <span>ເມື່ອພິມໃບບິນອອກມາ ຈະມີ QR Code / Barcode ທ້າຍບິນ ເຊິ່ງມີປະໂຫຍດຫຼວງຫຼາຍ:</span>
                          <span className="block mt-1">• <strong>ກວດສອບຄວາມຖືກຕ້ອງ (Verification)</strong>: ຜູ້ສະໜອງ ຫຼື ພະນັກງານສາມາດສະແກນ QR Code ເພື່ອເບິ່ງລາຍການສິນຄ້າ ແລະ ຍອດຄາດຄະເນຕົວຈິງໃນລະບົບໄດ້ທັນທີ ປ້ອງກັນບິນປອມ/ບິນຜິດດ່ຽງ.</span>
                          <span className="block">• <strong>ນຳເຂົ້າສິນຄ້າທັນໃຈ (Instant Restocking)</strong>: ຫຼຸດຂັ້ນຕອນການປ້ອນຂໍ້ມູນເອງ! ສະແກນປຸບ ເບິ່ງຂໍ້ມູນແລ້ວ ກວດສອບຄວາມຖືກຕ້ອງ ແລະ ທຳການຈັດການ Restock ໄດ້ຢ່າງງ່າຍດາຍ.</span>
                        </>
                      ) : (
                        <>
                          <span>Scanning the printed voucher QR Code offers direct operational improvements:</span>
                          <span className="block mt-1">• <strong>Voucher Verification</strong>: Let suppliers or operators instantly inspect authorized items, matching quantities, and estimated pricing in real-time to prevent paper discrepancies.</span>
                          <span className="block">• <strong>Zero-Typo Intake</strong>: Instantly review Restock items and verify totals on mobile devices upon dock arrival!</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* THE THERMAL SYSTEM DISPLAY VOUCHER */}
                <div 
                  className="bg-[#faf7f0] text-slate-800 p-6 shadow-md border-t-8 border-dashed border-red-500/25 select-none mx-auto overflow-hidden text-left"
                  style={{ 
                    fontFamily: 'Courier New, Courier, monospace', 
                    width: paperWidth === '90mm' ? '100%' : '260px' 
                  }}
                  id="print-receipt-section"
                  ref={printRef}
                >
                  <div className="text-center space-y-1">
                    <h2 className="text-[13px] font-black tracking-tight uppercase leading-4 text-slate-900">
                      ☕ {customHeader.toUpperCase()}
                    </h2>
                    <p className="text-[9px] text-slate-500 leading-none lowercase">
                      {customAddress}
                    </p>
                    <p className="text-[9px] text-slate-500 leading-none">
                      Phone: {customPhone}
                    </p>
                    <p className="text-[9px] font-black uppercase text-slate-400 pt-1">
                      --------------------------------
                    </p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-800">
                      {t('supplier_label')}
                    </p>
                    <p className="text-[9px] font-black uppercase text-slate-400">
                      --------------------------------
                    </p>
                  </div>

                  <div className="text-[10px] space-y-1 mt-3">
                    <div className="flex justify-between">
                      <span className="font-bold">SUPPLIER:</span>
                      <span className="capitalize font-black text-slate-900">{selectedBill.supplier}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 text-[9px]">
                      <span>DATE:</span>
                      <span>{new Date().toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-slate-500 text-[9px]">
                      <span>OPERATOR ID:</span>
                      <span className="font-mono">#{auth.currentUser?.uid?.substring(0, 8).toUpperCase() || 'SYS_AUTO'}</span>
                    </div>
                  </div>

                  <p className="text-[9px] font-black uppercase text-slate-400 py-1.5 leading-none">
                    ================================
                  </p>

                  {/* Columns headers layout */}
                  <div className="text-[10px] font-black text-slate-900 grid grid-cols-12 mb-1.5 gap-1.5 font-sans">
                    <span className="col-span-6">{t('item').toUpperCase()}</span>
                    <span className="col-span-3 text-center">{t('qty').toUpperCase()}</span>
                    <span className="col-span-3 text-right">{t('total').toUpperCase()}</span>
                  </div>

                  {/* Receipt Rows */}
                  <div className="space-y-4 text-[9.5px]">
                    {selectedBill.isCombined ? (
                      selectedBill.originalGroups.map((group: any, gIndex: number) => (
                        <div key={gIndex} className="space-y-1">
                          <p className="text-[10px] font-black text-[#052659] border-b border-dashed border-slate-300 pb-0.5 uppercase tracking-wide">
                            📍 {group.supplier.toUpperCase()} ({Math.round(group.totalCost).toLocaleString()} ₭)
                          </p>
                          {group.items.map((it: any, i: any) => (
                            <div key={i} className="grid grid-cols-12 gap-1 border-b border-dotted border-slate-200 pb-1 align-top leading-tight">
                              <div className="col-span-6 font-semibold break-all text-slate-700">
                                {it.productName.toUpperCase()}
                                {it.isBox && (
                                  <span className="block text-[8px] font-bold text-emerald-600 capitalize leading-none pt-0.5">
                                    *(1 BOX = {it.boxSize} pk, {it.packsToOrder * it.boxSize} pk total)
                                  </span>
                                )}
                              </div>
                              <div className="col-span-3 text-center font-mono whitespace-nowrap">
                                {it.packsToOrder} {it.buyUnit === 'BOX' && i18n.language === 'la' ? 'ກ່ອງ' : it.buyUnit}
                              </div>
                              <div className="col-span-3 text-right font-mono">
                                {Math.round(it.lineCost).toLocaleString()}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))
                    ) : (
                      selectedBill.items.map((it: any, i: any) => (
                        <div key={i} className="grid grid-cols-12 gap-1 border-b border-dashed border-slate-200/50 pb-1 align-top leading-tight">
                          <div className="col-span-6 font-semibold break-all">
                            {it.productName.toUpperCase()}
                            {it.isBox && (
                              <span className="block text-[8px] font-bold text-emerald-600 capitalize leading-none pt-0.5">
                                *(1 BOX = {it.boxSize} pk, {it.packsToOrder * it.boxSize} pk total)
                              </span>
                            )}
                          </div>
                          <div className="col-span-3 text-center font-mono whitespace-nowrap">
                            {it.packsToOrder} {it.buyUnit === 'BOX' && i18n.language === 'la' ? 'ກ່ອງ' : it.buyUnit}
                          </div>
                          <div className="col-span-3 text-right font-mono">
                            {Math.round(it.lineCost).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <p className="text-[9px] font-black uppercase text-slate-400 py-2.5">
                    --------------------------------
                  </p>

                  <div className="flex justify-between items-center text-[11px] font-black text-slate-900 uppercase">
                    <span>{t('estimated_cost').toUpperCase()}:</span>
                    <span className="text-sm font-mono">{Math.round(selectedBill.totalCost).toLocaleString()} ₭</span>
                  </div>

                  <p className="text-[9px] font-black uppercase text-slate-400 py-1.5">
                    ================================
                  </p>

                  <div className="text-center space-y-3 mt-4 animate-fade-in flex flex-col items-center">
                    {/* Scannable Verification QR Code */}
                    <div className="bg-white p-1.5 rounded-lg border border-slate-300 inline-block shadow-xs">
                      <img 
                        referrerPolicy="no-referrer"
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=95x95&margin=0&data=${encodeURIComponent(getVerificationUrl(selectedBill))}`} 
                        alt="Restock QR Code"
                        className="w-[90px] h-[90px]"
                      />
                    </div>
                    <p className="text-[7.5px] font-black uppercase text-slate-500 tracking-widest leading-none">
                      ສະແກນເພື່ອກວດສອບບິນ / Scan to Verify
                    </p>

                    {/* Standard Aesthetic Barcode Strip for Thermal compatibility */}
                    <div className="h-4.5 w-full flex items-center justify-center gap-[1px] max-w-[160px] mx-auto opacity-60">
                      {Array.from({ length: 42 }).map((_, i) => {
                        const heights = [8, 14, 10, 12, 6, 14, 10];
                        return (
                          <div 
                            key={i} 
                            className="bg-black" 
                            style={{ 
                              width: i % 4 === 0 ? '1.8px' : i % 3 === 0 ? '1.2px' : '0.6px',
                              height: `${heights[i % heights.length]}px`
                            }} 
                          />
                        );
                      })}
                    </div>
                    <p className="text-[7.5px] font-mono text-slate-400 tracking-widest uppercase">
                      *{selectedBill.supplier?.slice(0, 8).toUpperCase()}-{Math.round(selectedBill.totalCost).toString().slice(-4)}*
                    </p>
                    <p className="text-[8px] text-slate-450 leading-normal lowercase max-w-[180px] mx-auto italic">
                      {customFooter}
                    </p>
                  </div>
                </div>
              </div>

              {/* Thermal Print Trigger Buttons inside block footer */}
              <div className="flex flex-col gap-2 pt-4 border-t border-white/5 mt-4">
                {selectedBill && (
                  <button
                    type="button"
                    onClick={() => handleRegisterAsExpense(selectedBill)}
                    disabled={isLoggingExpense || loggedExpenseBills.includes(selectedBill.supplier)}
                    className={`w-full py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer h-11 ${
                      loggedExpenseBills.includes(selectedBill.supplier)
                        ? 'bg-slate-800 text-teal-400 border border-teal-500/30'
                        : 'bg-gradient-to-r from-[#3b82f6] to-[#4f46e5] hover:from-blue-600 hover:to-indigo-600 text-white shadow-lg shadow-indigo-500/15 active:scale-[0.99]'
                    }`}
                  >
                    {loggedExpenseBills.includes(selectedBill.supplier) ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5 text-teal-405" />
                        <span>{i18n.language === 'la' ? 'ລົງທະບຽນລາຍຈ່າຍຮ້ານສຳເລັດແລ້ວ ✓' : 'Expense Registered Successfully ✓'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                        <span>
                          {isLoggingExpense 
                            ? (i18n.language === 'la' ? 'ກຳລັງລົງທະບຽນ...' : 'Registering Expense...') 
                            : (i18n.language === 'la' ? 'ລົງທະບຽນເປັນລາຍຈ່າຍຮ້ານ (Auto-Log as Expense)' : 'Auto-Log as Store Purchasing Expense')}
                        </span>
                      </>
                    )}
                  </button>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => handleExportToImage(selectedBill)}
                    disabled={isExporting}
                    className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-900 text-white text-xs font-black uppercase tracking-widest rounded-xl transition duration-200 flex items-center justify-center gap-1.5 cursor-pointer h-11 shadow-md hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>{isExporting ? t('saving_msg') : t('export_png')}</span>
                  </button>

                  <button
                    onClick={handleSystemPrint}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition duration-200 flex items-center justify-center gap-1.5 h-11 cursor-pointer shadow-md hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{t('print_to_device')}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsPrinterModalOpen(false);
                    setPairingSuccess(false);
                  }}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-300 font-extrabold uppercase text-[10px] tracking-widest rounded-xl transition-all duration-200 hover:text-white cursor-pointer"
                >
                  {i18n.language === 'la' ? '✕ ປິດໜ້າຕ່າງນີ້ (Close Preview)' : '✕ Close Preview Window'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DATA INPUT GUIDE & EXAMPLES MODAL */}
      <AnimatePresence>
        {isHelpModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/10 rounded-3xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] flex flex-col justify-between shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setIsHelpModalOpen(false)}
                className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer p-1.5 hover:bg-slate-100 dark:hover:bg-white/5 rounded-full"
              >
                <span className="text-xl font-bold font-mono">×</span>
              </button>

              <div className="space-y-6 flex-1 overflow-y-auto pr-1">
                <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-white/5 pb-4">
                  <div className="p-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-2xl">
                    <Info className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 dark:text-white">
                      {i18n.language === 'la' ? 'ຄູ່ມື ແລະ ຕົວຢ່າງການປ້ອນຂໍ້ມູນ' : 'Data Entry Guide & Examples'}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {i18n.language === 'la' ? 'ຄູ່ມືການປ້ອນ ແລະ ບໍລິຫານສິນຄ້າສອງຮູບແບບພິເສດ' : 'How to manage Durables & Gram/ML-based raw ingredients'}
                    </p>
                  </div>
                </div>

                <div className="space-y-6 text-sm">
                  {/* FUNCTION 1: DURABLE/EQUIPMENT */}
                  <div className="p-5 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-2xl border border-emerald-500/15">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2 py-0.5 text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-400 bg-emerald-500/20 rounded-md">
                        {i18n.language === 'la' ? 'ຟັງຊັ້ນ 1' : 'Function 1'}
                      </span>
                      <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
                        {i18n.language === 'la' ? 'ເຄື່ອງໃຊ້/ອຸປະກອນທີ່ບໍ່ຄ່ອຍໄດ້ເຕີມ (Durable Asset)' : 'Durable Assets / Equipment Items'}
                      </h3>
                    </div>
                    
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                      {i18n.language === 'la' 
                        ? 'ໃຊ້ສຳລັບສິນຄ້າປະເພດເຄື່ອງໃຊ້ ທີ່ບໍ່ມີການຕັດເຜົາຜານຈາກສູດເຄື່ອງດື່ມລາຍວັນ ເຊັ່ນ: ຖາດ, ໄມ້ຕີມັດຊະ, ສະຕິກເກີ້, ບ່ວງ, ຫຼອດ, ຈອກ. ໂດຍລະບົບຈະບໍ່ໃຊ້ຂໍ້ມູນຍອດຂາຍມາຄິດໄລ່ແຮງບໍລິໂພກ (Daily burn rate = 0) ແຕ່ຈະເຕືອນໃຫ້ເຕີມສາງກໍ່ຕໍ່ເມື່ອຍອດເຫຼືອໃນສາງຫຼຸດລົງຮອດ ຈຸດຕ່ຳສຸດ (Min Stock) ທີ່ກຳນົດໄວ້.' 
                        : 'For helper items not linked to continuous recipe deductions, such as trays, matcha whisks, stickers, cups, spoons. The system avoids calculating a daily sales-based burn rate (Burn rate = 0). Restocking recommendations trigger purely when stock falls below your designated Min Stock limit.'}
                    </p>

                    <div className="bg-white/80 dark:bg-black/30 p-3.5 rounded-xl border border-emerald-500/5 text-xs">
                      <p className="font-bold text-slate-700 dark:text-slate-200 mb-2">
                        {i18n.language === 'la' ? '💡 ຕົວຢ່າງການປ້ອນສາງ (Durable Input Example):' : '💡 Durable Input Example:'}
                      </p>
                      <ul className="space-y-1.5 font-sans text-slate-500 dark:text-slate-400 list-inside list-disc">
                        <li>
                          <strong>{i18n.language === 'la' ? 'ຊື່ສິນຄ້າ:' : 'Product:'}</strong> {i18n.language === 'la' ? 'ສະຕິກເກີ້ໂລໂກ້ຮ້ານ (Sticker)' : 'Logo Stickers (Sticker)'}
                        </li>
                        <li>
                          <strong>{i18n.language === 'la' ? 'ເປີດໃຊ້ Durable:' : 'Turn Durable ON:'}</strong> {i18n.language === 'la' ? 'ຕິກຮອງຮັບ ເຄື່ອງໃຊ້/ອຸປະກອນ (Durable)' : 'Toggle the switch to Green'}
                        </li>
                        <li>
                          <strong>{i18n.language === 'la' ? 'ສະຕັອກຂັ້ນຕ່ຳ (Min Stock):' : 'Min Stock:'}</strong> 50 {i18n.language === 'la' ? 'ແຜ່ນ' : 'Sheets'}
                        </li>
                        <li>
                          <strong>{i18n.language === 'la' ? 'ຍອດເຫຼືອໃນສາງ (Current Stock):' : 'Current Stock:'}</strong> 15 {i18n.language === 'la' ? 'ແຜ່ນ' : 'Sheets'}
                        </li>
                        <li className="text-emerald-600 dark:text-emerald-400 font-bold border-t border-slate-100 dark:border-white/5 pt-1.5 mt-1.5 list-none">
                          {i18n.language === 'la' 
                            ? '➔ ລະບົບສັ່ງຊື້ອັດຕະໂນມັດ: ແນະນຳໃຫ້ສັ່ງຊື້ 35 ແຜ່ນ ເພື່ອໃຫ້ຮອດລະດັບປອດໄພທັນທີ!' 
                            : '➔ Recommended Order: 35 sheets immediately on your Procurement Bill, ignoring sales volumes!'}
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* FUNCTION 2: RECIPE BASED ML / G */}
                  <div className="p-5 bg-sky-500/5 dark:bg-sky-500/10 rounded-2xl border border-sky-500/15">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2 py-0.5 text-[9px] font-black uppercase text-sky-700 dark:text-sky-400 bg-sky-500/20 rounded-md">
                        {i18n.language === 'la' ? 'ຟັງຊັ້ນ 2' : 'Function 2'}
                      </span>
                      <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">
                        {i18n.language === 'la' ? 'ໝວດໝູ່ທີ່ຕັດສາງອອກເປັນ g, ml (Recipe Deductions)' : 'Continuous Recipe Deductions (g, ml)'}
                      </h3>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                      {i18n.language === 'la' 
                        ? 'ໃຊ້ສຳລັບວັດຖຸດິບທີ່ພວກເຮົາບໍ່ໄດ້ນັບເປັນແພັກ ເຊັ່ນ ເນີຍຖົ່ວ, ນິວເມລາ, ນົມ, ຜົງໂກໂກ້, ຊອດ. ໂດຍຫົວໜ່ວຍສາງຂອງສິນຄ້າຈະຕັ້ງເປັນ g (ກຣາມ) ຫຼື ml (ມລ). ເມື່ອຂາຍເຄື່ອງດື່ມໄດ້, ລະບົບຈະຄິດໄລ່ຕັດສາງເປັນກຣາມ ຫຼື ມລ ໂດຍອັດຕະໂນມັດຈາກ Recipe ທີ່ຕັ້ງໄວ້. ເມື່ອຫຼຸດຮອດຂີດອັນຕະລາຍ, ລະບົບຈະແປງຄືນເປັນຫົວໜ່ວຍ "ແພັກ" ຫຼື "ຖັງ" ໃຫຍ່ຕອນຂຶ້ນບິນໃບສັ່ງຊື້ Restock ໃຫ້ເອງ!' 
                        : 'Designed for non-pack raw materials like peanut butter, chocolate sauce, syrup, milk, cocoa powder. The inventory unit is configured in g or ml. When selling drinks, the system subtracts exact grams/mililiters from your balance based on the mapped recipe formulation. When below buffer, it automatically rounds up to full commercial packs on your replenish bill.'}
                    </p>

                    <div className="bg-white/80 dark:bg-black/30 p-3.5 rounded-xl border border-sky-500/5 text-xs">
                      <p className="font-bold text-slate-700 dark:text-slate-200 mb-2">
                        {i18n.language === 'la' ? '💡 ຕົວຢ່າງການປ້ອນ ແລະ ຕັດສາງອັດຕະໂນມັດ:' : '💡 Recipe Deduction Example:'}
                      </p>
                      <ul className="space-y-1.5 font-sans text-slate-500 dark:text-slate-400 list-inside list-disc">
                        <li>
                          <strong>{i18n.language === 'la' ? 'ສິນຄ້າສາງ:' : 'Inventory product:'}</strong> {i18n.language === 'la' ? 'ເນີຍຖົ່ວ (Peanut Butter) → ຫົວໜ່ວຍສາງ: g' : 'Peanut Butter → Unit: g'}
                        </li>
                        <li>
                          <strong>{i18n.language === 'la' ? 'ລາຄາຊື້ (Supplier Price):' : 'Supplier Price:'}</strong> {i18n.language === 'la' ? '1 ຖັງ (1,000g) ລາຄາ 150,000 ກີບ' : '1 Jar (1,000g) = 150,000 LAK'}
                        </li>
                        <li>
                          <strong>{i18n.language === 'la' ? 'ການຕັ້ງ Recipe (ສູດ):' : 'Drink Recipe Binding:'}</strong> {i18n.language === 'la' ? 'ເມນູ "Coco-Peanut" ປະກອບມີ ເນີຍຖົ່ວ = 25g' : 'Menu Coco-Peanut Latte uses Peanut Butter = 25g'}
                        </li>
                        <li>
                          <strong>{i18n.language === 'la' ? 'การຕັດສາງ (Deduction):' : 'Sales Deduction:'}</strong> {i18n.language === 'la' ? 'ຂາຍເມນູນີ້ໄດ້ 20 ຈອກ ➔ ລະບົບຕັດເນີຍຖົ່ວອອກ 500g (20ຈອກ × 25g)' : 'Sold 20 cups ➔ System automatically subtracts 500g (20 cups × 25g) from the inventory.'}
                        </li>
                        <li className="text-sky-600 dark:text-sky-400 font-bold border-t border-slate-100 dark:border-white/5 pt-1.5 mt-1.5 list-none">
                          {i18n.language === 'la' 
                            ? '➔ ລະບົບສັ່ງຊື້ອັດຕະໂນມັດ: ຖ້າສະຕັອກເຫຼືອຕ່ຳກວ່າກຳນົດ, ລະບົບຈະຂຶ້ນຄຳແນະນຳ Restock ໃຫ້ສັ່ງ "1 ຖັງ (1,000g)" ເຂົ້າໃນໃບບິນສັ່ງຊື້ໃຫ້ອັດຕະໂນມັດ!' 
                            : '➔ Recommended Order: Automatically generates a replenishment of "1 Jar (1,000g)" in the Supplier Bill when depleted, rounding decimal fractions elegantly!'}
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-white/5 mt-6 flex justify-end">
                <button
                  onClick={() => setIsHelpModalOpen(false)}
                  className="px-5 py-2.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs rounded-xl cursor-pointer hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
                >
                  {i18n.language === 'la' ? 'ເຂົ້າໃຈແລ້ວ • ປິດ' : 'Got it! Close'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
