import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import { 
  RefreshCcw, TrendingUp, Activity, Zap, Triangle, History, BrainCircuit, 
  Loader2, X, Search, ChevronRight, Package, ArrowUpDown, Sliders, AlertTriangle,
  Database, CloudLightning, DatabaseZap, CheckCircle2, ArrowRightLeft, Sparkles
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { format, subDays, parseISO, isSameDay } from 'date-fns';
import axios from 'axios';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';

interface DashboardProps {
  userSettings: any;
  user?: User | null;
  selectedBranch?: string;
}

export default function Dashboard({ userSettings, user, selectedBranch }: DashboardProps) {
  const { t, i18n } = useTranslation();

  // Data source: 'firestore' or 'sheets'
  const [dataSource, setDataSource] = useState<'firestore' | 'sheets'>(() => {
    return userSettings?.googleSheetsId ? 'sheets' : 'firestore';
  });

  const hasInitializedSource = useRef(false);

  useEffect(() => {
    if (userSettings?.googleSheetsId && !hasInitializedSource.current) {
      setDataSource('sheets');
      hasInitializedSource.current = true;
    } else if (userSettings && !userSettings.googleSheetsId && !hasInitializedSource.current) {
      setDataSource('firestore');
      hasInitializedSource.current = true;
    }
  }, [userSettings]);

  const [loading, setLoading] = useState(false);
  const [rawMovements, setRawMovements] = useState<any[]>([]);
  const [inventoryBalances, setInventoryBalances] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  // Firestore Collections States
  const [fsProducts, setFsProducts] = useState<any[]>([]);
  const [fsSupplierPrices, setFsSupplierPrices] = useState<any[]>([]);
  const [fsRecipes, setFsRecipes] = useState<any[]>([]);
  const [fsMenuSales, setFsMenuSales] = useState<any[]>([]);
  const [fsAdjustments, setFsAdjustments] = useState<any[]>([]);
  const [fsLoading, setFsLoading] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Modal States
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // --- CONVERSION HELPERS FOR FIRESTORE MOVEMENT CALCULATION ---
  const getSinglePackPriceLAK = (quote: any): number => {
    if (!quote) return 100000;
    if (quote.priceMode === 'total' || quote.priceMode === 'per_pack' || quote.totalPriceLAK !== undefined) {
      return Number(quote.priceLAK || 0);
    }
    const totalOriginal = Number(quote.priceOriginal || 0);
    const exchangeRate = Number(quote.exchangeRate || 1);
    const totalLAK = quote.currency === 'LAK' ? totalOriginal : totalOriginal * exchangeRate;
    return totalLAK / Number(quote.quantity || 1);
  };

  const getSmartPackSize = (
    productName: string,
    productUnit: string,
    configPackSize?: number,
    quoteQuantityPerUnit?: number,
    quotePriceLAK?: number
  ): number => {
    if (quoteQuantityPerUnit && quoteQuantityPerUnit > 1) {
      return quoteQuantityPerUnit;
    }
    if (configPackSize && configPackSize > 1) {
      return configPackSize;
    }
    const name = (productName || '').toLowerCase().trim();
    const prodUnit = (productUnit || '').toLowerCase().trim();

    const numericUnitsMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:g|ml|ກຣາມ|ມລ|gram|milliliter)/);
    if (numericUnitsMatch) {
      return parseFloat(numericUnitsMatch[1]);
    }
    const kgLMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:kg|l|ກລ|ກິໂລ|ລິດ|litre|kilogram)/);
    if (kgLMatch) {
      return parseFloat(kgLMatch[1]) * 1000;
    }
    const laKMatch = name.match(/(\d+(?:\.\d+)?)\s*(?:ກ|k)/);
    if (laKMatch) {
      return parseFloat(laKMatch[1]) * 1000;
    }
    const priceLAK = quotePriceLAK || 0;
    if (prodUnit === 'g' || prodUnit === 'ml') {
      if (priceLAK > 1000) {
        return 1000;
      }
    }
    return 1;
  };

  const getCommercialPackSize = (productName: string, unit: string): number => {
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
      return 500;
    }
    if (u === 'ml' || u === 'ມລ' || u === 'ລິດ' || u === 'l') {
      if (name.includes('ນົມ') || name.includes('milk') || name.includes('ເຊື່ອມ') || name.includes('syrup')) {
        return 1000;
      }
      return 1000;
    }
    return 1;
  };

  const getIngredientBaseQtyAndCost = (
    amount: number,
    ingUnitStr: string,
    prod: any,
    costStructure: { perUnit: number; pricePerPack: number; qtyPerPack: number }
  ) => {
    const normalizedIngUnit = (ingUnitStr || prod?.unit || 'g').toLowerCase().trim();
    const normalizedProdUnit = (prod?.unit || 'g').toLowerCase().trim();
    let packSize = costStructure.qtyPerPack || (prod ? getSmartPackSize(prod.name, prod.unit, prod.packSize) : 1);
    if (prod && packSize <= 1) {
      packSize = getCommercialPackSize(prod.name, (prod.unit || 'g').toLowerCase());
    }

    let baseUnits = amount;
    let cost = 0;

    if (
      normalizedIngUnit === 'pack' || 
      normalizedIngUnit === 'box' || 
      normalizedIngUnit === 'bag' || 
      normalizedIngUnit === 'unit'
    ) {
      baseUnits = amount * packSize;
      cost = amount * (costStructure.pricePerPack || 0);
    } else if (normalizedIngUnit === 'kg') {
      baseUnits = amount * 1000;
      cost = baseUnits * costStructure.perUnit;
    } else if (normalizedIngUnit === 'l' || normalizedIngUnit === 'litre') {
      baseUnits = amount * 1000;
      cost = baseUnits * costStructure.perUnit;
    } else if (normalizedIngUnit === 'pcs' || normalizedIngUnit === 'piece') {
      if (normalizedProdUnit === 'pcs' || normalizedProdUnit === 'piece' || normalizedProdUnit === 'unit') {
        baseUnits = amount;
        cost = amount * costStructure.perUnit;
      } else {
        baseUnits = amount * packSize;
        cost = amount * (costStructure.pricePerPack || 0);
      }
    } else {
      baseUnits = amount;
      cost = amount * costStructure.perUnit;
    }

    return { baseUnits, cost };
  };

  // Subscribe to all Firestore collections for real-time reactive sync
  useEffect(() => {
    setFsLoading(true);
    const unsubscribes: Array<() => void> = [];

    try {
      const qProducts = query(collection(db, 'products'));
      const qPrices = query(collection(db, 'supplierPrices'));
      const qRecipes = query(collection(db, 'recipes'));
      const qSales = query(collection(db, 'menu_sales'));
      const qAdj = query(collection(db, 'inventory'));

      unsubscribes.push(onSnapshot(qProducts, (snap) => {
        setFsProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'products')));

      unsubscribes.push(onSnapshot(qPrices, (snap) => {
        setFsSupplierPrices(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'supplierPrices')));

      unsubscribes.push(onSnapshot(qRecipes, (snap) => {
        setFsRecipes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'recipes')));

      unsubscribes.push(onSnapshot(qSales, (snap) => {
        setFsMenuSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, error => handleFirestoreError(error, OperationType.LIST, 'menu_sales')));

      unsubscribes.push(onSnapshot(qAdj, (snap) => {
        setFsAdjustments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setFsLoading(false);
      }, error => handleFirestoreError(error, OperationType.LIST, 'inventory')));

    } catch (err) {
      console.error("Firestore loading error:", err);
      setFsLoading(false);
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, []);

  // Compute Firestore-derived stock balances & raw movements
  const derivedFsData = useMemo(() => {
    if (fsProducts.length === 0) return null;

    // 1. Calculate Unit Costs
    const costMap: { [productId: string]: { perUnit: number; pricePerPack: number; label: string; qtyPerPack: number; buyUnit: string } } = {};
    fsProducts.forEach(p => {
      const pPrices = fsSupplierPrices.filter(sp => sp.productId === p.id);
      if (pPrices.length > 0) {
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
        const singlePackPriceLAK = getSinglePackPriceLAK(latest);
        let sizePerPack = getSmartPackSize(p.name, p.unit, p.packSize, latest.quantityPerUnit, singlePackPriceLAK);
        if (sizePerPack <= 1) {
          sizePerPack = getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase());
        }
        
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

    // 2. Synthesize Movements
    const mData: any[] = [];

    // - Stock In
    fsSupplierPrices.forEach(sp => {
      const p = fsProducts.find(prod => prod.id === sp.productId);
      if (!p) return;
      const packPriceLAK = getSinglePackPriceLAK(sp);
      let size = getSmartPackSize(p.name, p.unit, p.packSize, sp.quantityPerUnit, packPriceLAK);
      if (size <= 1) {
        size = getCommercialPackSize(p.name, (p.unit || 'g').toLowerCase());
      }
      const qty = (sp.quantity || 0) * size;
      if (qty > 0) {
        mData.push({
          date: sp.date || format(new Date(), 'yyyy-MM-dd'),
          item: p.name,
          type: 'IN',
          quantity: qty,
          remark: `Procured: ${sp.supplier || 'Corporate'}`
        });
      }
    });

    // - Adjustments
    fsAdjustments.forEach(adj => {
      const p = fsProducts.find(prod => prod.id === adj.productId);
      if (!p) return;
      const amount = adj.amount || 0;
      if (amount !== 0) {
        mData.push({
          date: adj.date || format(new Date(), 'yyyy-MM-dd'),
          item: p.name,
          type: amount >= 0 ? 'IN' : 'OUT',
          quantity: Math.abs(amount),
          remark: adj.remark || 'Inventory Adjustment'
        });
      }
    });

    // - Sales Records (Consumed via recipes)
    fsMenuSales.forEach(sale => {
      const itemsSold = sale.itemsSold || {};
      Object.entries(itemsSold).forEach(([recipeId, qtySold]) => {
        const qty = Number(qtySold) || 0;
        if (qty <= 0) return;

        const recipe = fsRecipes.find(r => r.id === recipeId);
        if (!recipe) return;

        (recipe.ingredients || []).forEach((ing: any) => {
          const p = fsProducts.find(prod => prod.id === ing.productId);
          if (!p) return;

          const costStructure = costMap[p.id] || { perUnit: 0, pricePerPack: 0, label: 'g', qtyPerPack: p.packSize || 1 };
          const { baseUnits } = getIngredientBaseQtyAndCost(
            ing.amount,
            ing.unit || p.unit || 'g',
            p,
            {
              perUnit: costStructure.perUnit,
              pricePerPack: costStructure.pricePerPack,
              qtyPerPack: costStructure.qtyPerPack || p.packSize || 1
            }
          );

          mData.push({
            date: sale.date || format(new Date(), 'yyyy-MM-dd'),
            item: p.name,
            type: 'OUT',
            quantity: baseUnits * qty,
            remark: `Sales: ${recipe.menuName} (Qty: ${qty})`
          });
        });
      });
    });

    // Sort movements by date descending
    mData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // 3. Compute Balances
    const iData = fsProducts.map(p => {
      const itemMoves = mData.filter(m => m.item === p.name);
      const totalIn = itemMoves.filter(m => m.type === 'IN').reduce((sum, m) => sum + m.quantity, 0);
      const totalOut = itemMoves.filter(m => m.type === 'OUT').reduce((sum, m) => sum + m.quantity, 0);
      const current = Math.max(0, totalIn - totalOut);

      return {
        name: p.name,
        totalIn,
        totalOut,
        current,
        minStock: p.minStock || 10,
        category: p.category || 'Ingredients'
      };
    });

    return { mData, iData };
  }, [fsProducts, fsSupplierPrices, fsRecipes, fsMenuSales, fsAdjustments]);

  // Synchronize Firestore derived states to main states when in firestore mode
  useEffect(() => {
    if (dataSource === 'firestore') {
      if (derivedFsData) {
        setRawMovements(derivedFsData.mData);
        setInventoryBalances(derivedFsData.iData);
        setError(null);
      } else {
        setRawMovements([]);
        setInventoryBalances([]);
      }
    }
  }, [dataSource, derivedFsData]);

  // Export from Google Sheets to Firestore
  const handleExportToFirestore = async () => {
    if (inventoryBalances.length === 0) {
      alert("No inventory data found from Google Sheets to export.");
      return;
    }
    setExporting(true);
    try {
      const batchPromises = inventoryBalances.map(async (item) => {
        let p = fsProducts.find(prod => prod.name.trim().toLowerCase() === item.name.trim().toLowerCase());
        let pId = p?.id;

        if (!p) {
          const docRef = await addDoc(collection(db, 'products'), {
            name: item.name.trim(),
            unit: 'g',
            category: item.category || 'Ingredients',
            minStock: item.minStock || 10,
            createdAt: serverTimestamp()
          });
          pId = docRef.id;
        }

        const existingAdj = fsAdjustments.filter(adj => adj.productId === pId);
        if (existingAdj.length === 0) {
          await addDoc(collection(db, 'inventory'), {
            productId: pId,
            amount: item.current,
            date: format(new Date(), 'yyyy-MM-dd'),
            remark: 'Imported from Google Sheets (Opening Balance)',
            createdAt: serverTimestamp()
          });
        }
      });

      await Promise.all(batchPromises);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
      alert(i18n.language === 'la' 
        ? "ນຳເຂົ້າຂໍ້ມູນໄປຍັງ Firestore ສຳເລັດແລ້ວ! ຕອນນີ້ທ່ານສາມາດປ່ຽນແຫຼ່ງຂໍ້ມູນເປັນ Firestore ໄດ້." 
        : "Exported successfully to Firestore! You can now switch your Data Source to Firestore.");
    } catch (err: any) {
      console.error("Export to Firestore failed:", err);
      alert("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  };


  // Playful / Simulation States
  const [currentQuoteIdx, setCurrentQuoteIdx] = useState(0);

  const tips = useMemo(() => [
    {
      la: "ການຈັດການສາງສິນຄ້າທີ່ດີ ຄືຫົວໃຈຂອງຮ້ານຄ້າ!",
      en: "Good stock planning is the heartbeat of retail!",
      emoji: "💡",
      color: "border-sky-500/20 bg-sky-500/5 text-sky-600 dark:text-sky-400"
    },
    {
      la: "ຫຼຸດລາຍຈ່າຍ ເພີ່ມປະສິດທິພາບ ສ້າງກຳໄລທີ່ຍືນຍົງ",
      en: "Reduce costs, maximize flow, build durable profits.",
      emoji: "🚀",
      color: "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
    },
    {
      la: "ຕິດຕາມທຸກການເຄື່ອນໄຫວ ເພື່ອການຕັດສິນໃຈທີ່ຖືກຕ້ອງ",
      en: "Every stock move tells a story—learn from your data flow.",
      emoji: "📊",
      color: "border-violet-500/20 bg-violet-500/5 text-violet-600 dark:text-violet-400"
    },
    {
      la: "ສິນຄ້າຄົງສາງທີ່ພໍດີ ຊ່ວຍໃຫ້ທຶນບໍ່ຈົມ",
      en: "Keep capital flowing by keeping inventory lean and active.",
      emoji: "⚡",
      color: "border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400"
    },
    {
      la: "ຄວາມໄວ້ວາງໃຈຂອງລູກຄ້າ ເລີ່ມຕົ້ນຈາກສິນຄ້າທີ່ມີພ້ອມສົ່ງ",
      en: "Excellent service begins with stock that is always ready for delivery.",
      emoji: "🌟",
      color: "border-pink-500/20 bg-pink-500/5 text-pink-600 dark:text-pink-400"
    }
  ], []);

  const getLaoGreeting = () => {
    const hours = new Date().getHours();
    if (hours < 12) return { text: "ສະບາຍດີຕອນເຊົ້າ", emoji: "🌅" };
    if (hours < 17) return { text: "ສະບາຍດີຍາມບ່າຍ", emoji: "☀️" };
    return { text: "ສະບາຍດີຕອນແລງ", emoji: "🌙" };
  };

  const greeting = getLaoGreeting();

  const fetchMatrixData = async () => {
    if (!userSettings?.googleSheetsId) return;
    
    setSyncing(true);
    setError(null);
    try {
      // Fetch Movements and Inventory in parallel
      const [movementsRes, inventoryRes] = await Promise.all([
        axios.get(`/api/sheets/stock-data/${userSettings.googleSheetsId}`),
        axios.get(`/api/sheets/inventory/${userSettings.googleSheetsId}`)
      ]);

    // Process Movements (DAILY INVENTORY MOVEMENT)
    const moveValues = movementsRes.data.values || [];
    let mData: any[] = [];
    if (moveValues.length > 0) {
      const headerIndex = moveValues.findIndex((row: any[]) => 
        row.some(cell => String(cell).toUpperCase().includes('ITEM') || String(cell).toUpperCase().includes('NAME'))
      );
      
      const headers = headerIndex !== -1 ? moveValues[headerIndex].map((h: any) => String(h).toUpperCase().trim()) : [];
      const itemCol = headers.findIndex(h => h.includes('ITEM') || h.includes('NAME'));
      const typeCol = headers.findIndex(h => h.includes('TYPE') || h.includes('ACTION'));
      const qtyCol = headers.findIndex(h => h.includes('QTY') || h.includes('QUANTITY') || h.includes('AMOUNT'));
      const dateCol = headers.findIndex(h => h.includes('DATE'));

      mData = moveValues
        .slice(headerIndex !== -1 ? headerIndex + 1 : 0)
        .filter((row: any[]) => {
          const itemName = String(row[itemCol === -1 ? 1 : itemCol] || '').trim();
          return itemName && !itemName.toUpperCase().includes('TOTAL') && !itemName.toUpperCase().includes('NAME') && !itemName.toUpperCase().includes('ITEM');
        })
        .map((row: any[]) => {
          const typeRaw = String(row[typeCol === -1 ? 2 : typeCol] || 'OUT').toUpperCase().trim();
          const isEntering = typeRaw.includes('IN') || typeRaw.includes('ເຂົ້າ') || typeRaw.includes('REC') || typeRaw.includes('ADD');

          return {
            date: row[dateCol === -1 ? 0 : dateCol] || '',
            item: String(row[itemCol === -1 ? 1 : itemCol] || '').trim(),
            type: isEntering ? 'IN' : 'OUT',
            quantity: parseFloat(String(row[qtyCol === -1 ? 3 : qtyCol] || '0').replace(/[^0-9.]/g, '')) || 0,
            remark: row[qtyCol + 1] || ''
          };
        });
      setRawMovements(mData);
    }

    // Process Inventory Balances (MAIN INVENTORY)
    const invValues = inventoryRes.data.values || [];
    let iData = [];
    if (invValues.length > 0) {
      const headerIndex = invValues.findIndex((row: any[]) => 
        row.some(cell => String(cell).toUpperCase().includes('NAME') || String(cell).toUpperCase().includes('ITEM'))
      );

      const headers = headerIndex !== -1 ? invValues[headerIndex].map((h: any) => String(h).toUpperCase().trim()) : [];
      const nameCol = headers.findIndex(h => h.includes('NAME') || h.includes('ITEM'));
      const inCol = headers.findIndex(h => h.includes('STOCK IN') || h.includes('TOTAL IN'));
      const outCol = headers.findIndex(h => h.includes('STOCK OUT') || h.includes('TOTAL OUT'));
      const currCol = headers.findIndex(h => h.includes('CURRENT') || h.includes('BALANCE'));
      const minCol = headers.findIndex(h => h.includes('MIN') || h.includes('SAFETY'));

      iData = invValues
        .slice(headerIndex !== -1 ? headerIndex + 1 : 0)
        .filter((row: any[]) => {
          const name = String(row[nameCol === -1 ? 0 : nameCol] || '').trim();
          return name && !name.toUpperCase().includes('TOTAL') && !name.toUpperCase().includes('NAME') && !name.toUpperCase().includes('ITEM');
        })
        .map((row: any[]) => ({
          name: String(row[nameCol === -1 ? 0 : nameCol] || '').trim(),
          totalIn: parseFloat(String(row[inCol === -1 ? 1 : inCol] || '0').replace(/[^0-9.]/g, '')) || 0,
          totalOut: parseFloat(String(row[outCol === -1 ? 2 : outCol] || '0').replace(/[^0-9.]/g, '')) || 0,
          current: parseFloat(String(row[currCol === -1 ? 3 : currCol] || '0').replace(/[^0-9.]/g, '')) || 0,
          minStock: parseFloat(String(row[minCol === -1 ? 4 : minCol] || '0').replace(/[^0-9.]/g, '')) || 0,
          category: row[6] || 'Uncategorized'
        }));
    }

    // Fallback: If inventory tab is empty, derive uniq items from movements
    if (iData.length === 0 && mData.length > 0) {
      const uniqueSourceNames = Array.from(new Set(mData.map(m => m.item)));
      iData = uniqueSourceNames.map(name => {
        const itemMoves = mData.filter(m => m.item === name);
        const tin = itemMoves.filter(m => m.type === 'IN').reduce((acc, curr) => acc + curr.quantity, 0);
        const tout = itemMoves.filter(m => m.type === 'OUT').reduce((acc, curr) => acc + curr.quantity, 0);
        return {
          name,
          totalIn: tin,
          totalOut: tout,
          current: tin - tout,
          minStock: 10, // Default fallback
          category: 'Auto-detected'
        };
      });
    }

    setInventoryBalances(iData);

      } catch (err: any) {
        console.error('Error fetching matrix data:', err);
        const data = err.response?.data;
        const detail = data?.message || data?.error || err.message;
        
        if (detail.includes("not configured")) {
          setError("GOOGLE_SHEETS_API_KEY is missing. Please add it to the Secrets panel in Settings.");
        } else if (detail.includes("not found") || detail.includes("404")) {
          setError("Sheet not found. Please verify your Sheet ID.");
        } else if (detail.includes("DAILY INVENTORY MOVEMENT") || detail.includes("range") || detail.includes("MAIN INVENTORY")) {
          setError("Structure Error: Ensure your spreadsheet has BOTH 'DAILY INVENTORY MOVEMENT' and 'MAIN INVENTORY' tabs with the correct columns.");
        } else {
          setError(`Matrix Error: ${detail}`);
        }
      } finally {
        setLoading(false);
        setSyncing(false);
        setLastSynced(new Date().toLocaleTimeString());
      }
    };

  useEffect(() => {
    if (dataSource === 'sheets') {
      fetchMatrixData();
    }
  }, [userSettings?.googleSheetsId, dataSource]);

  // Data Aggregation Logic
  const analytics = useMemo(() => {
    // 1. Stock Health (from Main Inventory)
    const stockHealth = [...inventoryBalances].map(item => {
      const currentVal = parseFloat(item.current) || 0;
      const minVal = parseFloat(item.minStock) || 0;
      const isCritical = currentVal <= minVal;
      const isWarning = currentVal <= (minVal * 1.5);
      
      // Calculate display percentage (cap at 100% for the bar)
      const capacity = minVal > 0 ? minVal * 3 : (currentVal > 0 ? currentVal * 1.5 : 10);
      const health = capacity > 0 ? Math.min(100, Math.round((currentVal / capacity) * 100)) : 100;

      return {
        name: item.name?.trim(),
        health,
        current: currentVal,
        min: minVal,
        status: isCritical ? 'Critical' : isWarning ? 'Warning' : 'Healthy'
      };
    }).sort((a, b) => {
      if (a.status === 'Critical' && b.status !== 'Critical') return -1;
      if (a.status !== 'Critical' && b.status === 'Critical') return 1;
      return a.health - b.health;
    });

    // 2. Movement Trends
    const last7Days = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i));
    const trendsByDay = last7Days.map(date => ({
      day: format(date, 'EEE'),
      fullDate: date,
      in: 0,
      out: 0
    }));

    rawMovements.forEach(m => {
      try {
        // Handle formats like "5/9/2026 14:39:10" or "2026-05-09"
        let mDate: Date;
        if (m.date && String(m.date).includes('/')) {
          const [datePart] = String(m.date).split(' ');
          const parts = datePart.split('/');
          
          if (parts.length === 3) {
            const p0 = parseInt(parts[0]);
            const p1 = parseInt(parts[1]);
            const p2 = parseInt(parts[2]);

            // Detect M/D/Y vs D/M/Y
            // If the first part is > 12, it must be D/M/Y
            // If the sheet screenshot showed 5/9/2026 (May 9), it's likely M/D/Y for US or D/M/Y for Laos
            // Let's try to assume D/M/Y first if p0 > 12, else stick to a safer guess
            if (p0 > 12) {
              mDate = new Date(p2, p1 - 1, p0); // D/M/Y
            } else if (p1 > 12) {
              mDate = new Date(p2, p0 - 1, p1); // M/D/Y
            } else {
              // Ambiguous, assume M/D/Y as seen in common sheet defaults or D/M/Y for local
              // The user metadata shows 2026-05-18. 
              // If the sheet says 5/9/2026, and today is May 18, 5/9 is likely May 9 (M/D/Y)
              mDate = new Date(p2, p0 - p0 > 12 ? 0 : p0 - 1, p1); 
              // Re-simplify:
              mDate = new Date(p2, p0 - 1, p1); // Assume M/D/Y for now as it fits May 9
            }
          } else {
            mDate = new Date(m.date);
          }
        } else {
          mDate = new Date(m.date);
        }

        if (isNaN(mDate.getTime())) return;
        const dayTrend = trendsByDay.find(t => isSameDay(t.fullDate, mDate));
        if (dayTrend) {
          const qty = parseFloat(m.quantity) || 0;
          if (m.type === 'IN') dayTrend.in += qty;
          else if (m.type === 'OUT') dayTrend.out += qty;
        }
      } catch (e) {}
    });

    // 3. Burn Rates & Velocity
    const burnRates = [...inventoryBalances].map(item => {
      const itemName = item.name?.trim().toLowerCase();
      const itemMoves = rawMovements.filter(m => 
        m.item?.trim().toLowerCase() === itemName && 
        m.type === 'OUT'
      );
      
      const totalOut = itemMoves.reduce((acc, m) => acc + (parseFloat(m.quantity) || 0), 0);
      // Normalize dates to ignore time for unique day count
      const daysWithMove = new Set(itemMoves.map(m => String(m.date || '').split(' ')[0].trim())).size;
      const avgDaily = daysWithMove > 0 ? totalOut / daysWithMove : 0;

      return {
        item: item.name,
        rate: `${avgDaily.toFixed(1)} / day`,
        velocity: avgDaily > (parseFloat(item.minStock) / 5) ? 'Fast' : 'Normal',
        current: parseFloat(item.current) || 0,
        avg: avgDaily
      };
    }).sort((a, b) => b.avg - a.avg);

    // 4. Forecasts
    const forecasts = [...burnRates].map(b => {
      const days = b.avg > 0 ? Math.floor(b.current / b.avg) : 999;
      let status = 'HEALTHY';
      if (days < 7) status = 'CRITICAL';
      else if (days < 14) status = 'WARNING';
      else if (days < 30) status = 'LOW';

      return {
        item: b.item,
        daysRemaining: days < 0 ? 0 : days,
        date: format(subDays(new Date(), -(days < 0 ? 0 : days)), 'MMM dd'),
        avgRate: b.avg.toFixed(1),
        currentStock: b.current,
        status
      };
    }).filter(f => f.avgRate !== '0.0' && f.daysRemaining < 60).sort((a, b) => a.daysRemaining - b.daysRemaining);

    const topOut = [...burnRates].slice(0, 5).map(b => b.item);

    return { stockHealth, trends: trendsByDay, burnRates, forecasts, topOut };
  }, [rawMovements, inventoryBalances]);

  if (dataSource === 'sheets' && !userSettings?.googleSheetsId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 glass-card bg-amber-50 dark:bg-amber-900/10 border-amber-200">
        <Triangle className="w-12 h-12 text-amber-500 mb-4 fill-amber-500/10" />
        <h3 className="text-lg font-black uppercase text-amber-900 dark:text-amber-400">Sheet Connection Required</h3>
        <p className="text-xs text-amber-800/60 dark:text-amber-400/60 mt-2 font-bold max-w-sm text-center">
          Please link your Google Sheet ID in the <span className="text-amber-900 underline">Settings</span> tab to activate life intelligence data, or switch your Data Source above to use Firestore.
        </p>
      </div>
    );
  }

  const isCurrentlyLoading = dataSource === 'firestore' ? fsLoading : (loading && rawMovements.length === 0);

  if (isCurrentlyLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
        <p className="text-[10px] font-bold text-slate-400 uppercase mt-4 tracking-widest italic">
          {dataSource === 'firestore' ? 'READING REAL-TIME CLOUD DATABASE...' : 'Synchronizing with Google Matrix...'}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-6 glass-card bg-red-50 dark:bg-red-900/10 border-red-200 text-center">
        <Activity className="w-12 h-12 text-red-500 mb-4 animate-pulse" />
        <h3 className="text-lg font-black uppercase text-red-900 dark:text-red-400">Sync Failure</h3>
        <p className="text-xs text-red-800/80 dark:text-red-400/80 mt-2 font-bold max-w-lg">
          {error}
        </p>
        <div className="mt-8 p-6 bg-white dark:bg-white/5 rounded-3xl border border-red-100 dark:border-red-900/20 text-left w-full max-w-md">
           <p className="text-[10px] font-black uppercase tracking-widest text-[#052659] dark:text-white mb-4">Required Structure:</p>
           <ul className="space-y-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-tighter">
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div> Tab Name: <span className="text-red-600 font-black">daily inventory movement</span></li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div> Column A: Date (2024-05-17)</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div> Column B: Item Name</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div> Column C: Type (IN or OUT)</li>
              <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div> Column D: Quantity</li>
           </ul>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="mt-8 text-[10px] font-black uppercase tracking-widest text-primary hover:underline"
        >
          Re-Initialize Matrix
        </button>
      </div>
    );
  }

  const stockHealth = analytics?.stockHealth || [];
  const inOutData = analytics?.trends || [];
  const burnRates = analytics?.burnRates || [];
  const forecasts = analytics?.forecasts || [];
  const topOut = analytics?.topOut || [];

  return (
    <div className="space-y-6">
      {/* Intelligence Suite Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-2 border-b border-slate-100 dark:border-white/5 pb-4">
         <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
               <BrainCircuit className="w-5 h-5 text-primary animate-pulse" />
            </div>
            <div>
               <div className="flex items-center gap-2">
                 <h2 className="text-sm font-black uppercase tracking-widest text-[#052659] dark:text-white">Back Office Intelligence</h2>
                 <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 dark:bg-blue-400/10 dark:text-blue-400 border border-blue-500/20">
                   {(selectedBranch || 'branch_1') === 'branch_1' ? (i18n.language === 'la' ? 'ສາຂາ 1' : 'Branch 1') : (i18n.language === 'la' ? 'ສາຂາ 2' : 'Branch 2')}
                 </span>
               </div>
               <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">
                 {dataSource === 'firestore' ? (
                   <span className="text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                     <Database className="w-2.5 h-2.5" />
                     {i18n.language === 'la' ? 'ກຳລັງດຶງຂໍ້ມູນຈາກ Firestore' : 'Live Cloud Feed Active'}
                   </span>
                 ) : lastSynced ? (
                   <>
                     Last Synced: {lastSynced} • {inventoryBalances.length} Items • {rawMovements.length} Moves
                   </>
                 ) : (
                   'Synchronizing Matrix...'
                 )}
               </p>
            </div>
         </div>

         {/* Data Source Toggle & Sync Buttons */}
         <div className="flex flex-wrap items-center gap-3">
           {/* Data Source Toggle Switch */}
           <div className="flex items-center bg-slate-100 dark:bg-white/5 p-1 rounded-full border border-slate-200/50 dark:border-white/10 text-[9px] font-black uppercase tracking-wider">
             <button
               onClick={() => setDataSource('firestore')}
               className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all duration-300 ${
                 dataSource === 'firestore'
                   ? 'bg-primary text-white shadow-sm'
                   : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
               }`}
             >
               <Database className="w-3 h-3" />
               <span>Firestore DB</span>
             </button>
             <button
               onClick={() => setDataSource('sheets')}
               className={`px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all duration-300 ${
                 dataSource === 'sheets'
                   ? 'bg-primary text-white shadow-sm'
                   : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
               }`}
             >
               <CloudLightning className="w-3 h-3" />
               <span>Google Sheets</span>
             </button>
           </div>

           {/* Active Source Action Buttons */}
           <div className="flex items-center gap-2">
             {dataSource === 'sheets' && (
               <>
                 <button 
                   onClick={handleExportToFirestore}
                   disabled={exporting || inventoryBalances.length === 0}
                   className="crystal-button !py-2 !px-3 flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/40 hover:bg-indigo-100/50 animate-pulse hover:animate-none"
                   title="Export loaded Google Sheet data directly to Firestore Cloud Database"
                 >
                   {exporting ? (
                     <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
                   ) : exportSuccess ? (
                     <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                   ) : (
                     <DatabaseZap className="w-3 h-3 text-indigo-500" />
                   )}
                   <span className="text-[9px] font-black uppercase tracking-widest">
                     {exporting ? 'EXPORTING...' : exportSuccess ? 'EXPORTED!' : 'EXPORT TO FIRESTORE'}
                   </span>
                 </button>

                 <button 
                   onClick={() => fetchMatrixData()}
                   disabled={syncing}
                   className="crystal-button !py-2 !px-3 flex items-center gap-1.5 group"
                 >
                   <RefreshCcw className={`w-3 h-3 ${syncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                   <span className="text-[9px] font-black uppercase tracking-widest">
                     {syncing ? 'UPDATING...' : 'FORCE SYNC'}
                   </span>
                 </button>
               </>
             )}

             {dataSource === 'firestore' && (
               <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-600 dark:text-indigo-400">
                 <Sparkles className="w-3 h-3 animate-pulse" />
                 <span className="text-[8px] font-black uppercase tracking-widest">
                   {i18n.language === 'la' ? 'ຟີດສົດເຮັດວຽກຢູ່' : 'DURABLE CLOUD'}
                 </span>
               </div>
             )}
           </div>
         </div>
      </div>

      {/* Playful Daily Vibe & Tip Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        <div className="md:col-span-2 glass-card p-4 sm:p-6 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 transition-all duration-700 group-hover:scale-125 hover:rotate-12"></div>
          <div className="flex items-center gap-4 relative z-10 font-sans">
            <span className="text-4xl animate-bounce" style={{ animationDuration: '3s' }}>{greeting.emoji}</span>
            <div>
              <h3 className="text-xs font-black uppercase text-[#052659] dark:text-white tracking-wider leading-none mb-2 select-none">
                {greeting.text}, {user?.displayName || user?.email?.split('@')[0] || 'Partner'}!
              </h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tight font-sans">
                {format(new Date(), 'EEEE, dd MMMM yyyy (hh:mm a)')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-600 dark:text-emerald-400 animate-pulse">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping font-sans"></span>
            <span className="text-[9px] font-black uppercase tracking-widest font-sans">
              {i18n.language === 'la' ? 'ລະບົບເຮັດວຽກປົກກະຕິ' : 'SYSTEM ONLINE'}
            </span>
          </div>
        </div>

        <div className={`glass-card p-4 sm:p-6 border transition-all duration-500 cursor-pointer flex flex-col justify-between relative overflow-hidden group ${tips[currentQuoteIdx].color}`}
          onClick={() => setCurrentQuoteIdx((prev) => (prev + 1) % tips.length)}
        >
          <div className="absolute -bottom-4 -right-4 text-slate-500/10 font-bold text-6xl group-hover:scale-110 transition-transform">
            {tips[currentQuoteIdx].emoji}
          </div>
          <div className="flex-1 font-sans">
            <h5 className="text-[8px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center justify-between font-sans font-black">
              <span className="flex items-center gap-1.5 font-sans">
                {tips[currentQuoteIdx].emoji} BACK OFFICE INSPIRATION
              </span>
              <span className="underline select-none uppercase opacity-80 hover:opacity-100 text-[7px] font-black font-sans">
                {i18n.language === 'la' ? 'ກົດປ່ຽນ' : 'TAP TO SWAP'}
              </span>
            </h5>
            <p className="text-[11px] font-extrabold leading-tight tracking-tight mt-1">
              {tips[currentQuoteIdx].la}
            </p>
            <p className="text-[9px] uppercase tracking-wider font-bold opacity-70 mt-1 font-sans">
              {tips[currentQuoteIdx].en}
            </p>
          </div>
        </div>
      </div>

      {/* Primary Intelligence Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Stock Health */}
          <div className="high-density-card flex flex-col h-[350px] overflow-hidden">
            <div className="flex justify-between items-center mb-6">
               <h3 className="label-xs flex items-center gap-2">
                  <Activity className="w-3 h-3 text-green-500" />
                  Stock Health Analysis (Live Feed)
               </h3>
               <button 
                  onClick={() => setShowInventoryModal(true)}
                  className="text-[9px] font-black uppercase text-primary hover:underline flex items-center gap-1"
               >
                  View Full Inventory
                  <ChevronRight className="w-2.5 h-2.5" />
               </button>
            </div>
            
            <div className="flex-1 relative overflow-hidden mask-fade-vertical">
               {stockHealth.length > 0 ? (
                 <div 
                   className={`space-y-5 absolute top-0 left-0 w-full ${stockHealth.length > 2 ? 'animate-health-scroll' : ''}`}
                 >
                   {/* Triple the list to ensure seamless looping without gaps */}
                   {[...stockHealth, ...stockHealth, ...stockHealth].map((item, idx) => (
                      <div key={`${item.name}-${idx}`} className="space-y-2 group p-1">
                        <div className="flex justify-between items-end">
                          <div>
                            <p className="text-[10px] font-black uppercase text-[#052659] dark:text-white tracking-widest">{item.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                item.status === 'Critical' ? 'bg-red-500 text-white animate-pulse' : 
                                item.status === 'Warning' ? 'bg-amber-500 text-white' : 
                                'bg-emerald-500 text-white'
                              }`}>{item.status}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-[#052659] dark:text-white tracking-tighter leading-none">{item.current}</p>
                            <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">STOCK BALANCE</p>
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 mb-1">
                          <span>Inventory Level</span>
                          <span className={item.health < 20 ? 'text-red-500' : 'text-slate-400'}>{item.health}%</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-1000 ${
                              item.status === 'Critical' ? 'bg-red-500' : 
                              item.status === 'Warning' ? 'bg-amber-500' : 
                              'bg-emerald-500'
                            }`}
                            style={{ width: `${item.health}%` }}
                          ></div>
                        </div>
                      </div>
                   ))}
                 </div>
               ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <Package className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-[9px] font-black uppercase italic">No Inventory Data Found</p>
                </div>
               )}
            </div>
          </div>

         {/* IN vs OUT Trends */}
         <div className="lg:col-span-2 high-density-card flex flex-col h-[350px]">
            <div className="flex justify-between items-center mb-6">
               <h3 className="label-xs flex items-center gap-2">
                  <TrendingUp className="w-3 h-3 text-primary" />
                  IN vs OUT (7-Day Movement)
               </h3>
               <div className="flex gap-4 text-[9px] font-bold uppercase">
                  <div className="flex items-center gap-1.5">
                     <div className="w-2 h-2 rounded-full bg-primary/20"></div>
                     <span className="text-slate-400">Stock IN</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                     <div className="w-2 h-2 rounded-full bg-primary"></div>
                     <span className="text-slate-900 dark:text-white">Stock OUT</span>
                  </div>
               </div>
            </div>
            <div className="flex-1">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={inOutData}>
                     <defs>
                        <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#052659" stopOpacity={0.1}/>
                           <stop offset="95%" stopColor="#052659" stopOpacity={0}/>
                        </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                     <XAxis dataKey="day" fontSize={10} axisLine={false} tickLine={false} />
                     <YAxis fontSize={10} axisLine={false} tickLine={false} />
                     <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '11px', fontWeight: 800 }}
                     />
                     <Area type="monotone" dataKey="in" stroke="#94A3B8" fill="transparent" strokeWidth={2} strokeDasharray="5 5" />
                     <Area type="monotone" dataKey="out" stroke="#052659" fill="url(#colorOut)" strokeWidth={3} />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
         </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Burn Rate */}
          <div className="high-density-card flex flex-col justify-between group overflow-hidden relative">
             <div className="absolute top-0 right-0 p-3 text-amber-500/10 dark:text-amber-500/20 group-hover:scale-150 transition-transform duration-700">
                <Zap className="w-8 h-8" />
             </div>
             <div>
                <p className="label-xs text-slate-500 dark:text-blue-200/50 mb-3">Daily Burn Rate</p>
                {burnRates.length === 0 ? (
                   <p className="text-[10px] font-bold text-slate-400 italic">No data detected</p>
                ) : (
                   <div className="relative h-[115px] overflow-hidden mask-fade-vertical">
                      <div className={`space-y-3 relative z-10 ${burnRates.length > 3 ? 'animate-marquee-vertical' : ''}`}>
                         {burnRates.map((b, i) => (
                            <div key={`idx-${i}`} className="flex justify-between items-end border-b border-slate-100 dark:border-white/5 pb-2">
                               <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 truncate max-w-[150px]">{b.item}</span>
                               <span className="text-xs font-mono font-black text-rose-600 dark:text-amber-300">{b.rate}</span>
                            </div>
                         ))}
                         {/* Duplicate for seamless looping only if we have more than 3 items */}
                         {burnRates.length > 3 && burnRates.map((b, i) => (
                            <div key={`dup-${i}`} className="flex justify-between items-end border-b border-slate-100 dark:border-white/5 pb-2" aria-hidden="true">
                               <span className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 truncate max-w-[150px]">{b.item}</span>
                               <span className="text-xs font-mono font-black text-rose-600 dark:text-amber-300">{b.rate}</span>
                            </div>
                         ))}
                      </div>
                   </div>
                )}
             </div>
          </div>

         {/* Top 5 OUT */}
         <div className="high-density-card flex flex-col justify-between">
            <p className="label-xs text-slate-400 mb-4">Top Exhaustion (OUT)</p>
            <div className="space-y-2">
               {topOut.length > 0 ? topOut.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-bold uppercase">
                     <span className="w-4 text-primary opacity-30">0{i+1}</span>
                     <span className="text-slate-700 dark:text-white truncate">{item}</span>
                  </div>
               )) : (
                <p className="text-[9px] font-bold text-slate-400 italic">No data detected</p>
               )}
            </div>
         </div>

         {/* Forecasting */}
         <div className="high-density-card bg-blue-50 dark:bg-blue-900/20 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-blue-500/5 rounded-full"></div>
            <p className="label-xs text-blue-800/60 font-black">Stock-Out Forecast</p>
            <div className="mt-4 space-y-4">
               {forecasts.slice(0, 1).map((f, i) => (
                  <div key={i}>
                     <div className="flex justify-between items-center">
                        <span className="text-3xl font-black text-blue-900 dark:text-blue-400 tracking-tighter">{f.daysRemaining}</span>
                        <div className="text-right">
                           <span className="text-[10px] font-bold text-blue-800/40 uppercase block">Days left</span>
                           <span className="text-[8px] font-bold text-blue-500 uppercase opacity-60">Avg: {f.avgRate}/day</span>
                        </div>
                     </div>
                     <p className={`text-[11px] font-bold mt-1 uppercase tracking-widest leading-tight ${
                        f.status === 'CRITICAL' ? 'text-red-500' : 
                        f.status === 'WARNING' ? 'text-amber-500' : 
                        f.status === 'LOW' ? 'text-blue-500' : 
                        'text-slate-500'
                     }`}>
                        {f.status}: {f.item} ({f.date})
                     </p>
                     <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mt-2">Balance: {f.currentStock} in stock</p>
                  </div>
               ))}
            </div>
         </div>

         <div className="high-density-card bg-white dark:bg-[#052659] border-2 border-primary/20 flex flex-col justify-center items-center text-center p-6 bg-radial-gradient(from 50% 50%, circle, #fff, #f9fafb)">
            <Triangle className={`w-8 h-8 mb-3 fill-primary/10 ${stockHealth.filter(i => i.status === 'Critical').length > 0 ? 'text-red-500 fill-red-500/10 animate-pulse' : 'text-primary'}`} />
            <h4 className="text-[11px] font-black uppercase tracking-widest text-[#052659] dark:text-white">Replenishment Logic</h4>
            <div className="mt-2 space-y-2">
              <p className="text-[9px] text-slate-400 uppercase font-bold italic leading-tight">
                Scans Main Inventory for items with current stock reaching or falling below safety minimums.
              </p>
              <div className="text-[10px] text-primary dark:text-white font-black uppercase bg-primary/5 px-3 py-1.5 rounded-full border border-primary/10">
                {stockHealth.filter(i => i.status === 'Critical').length} Priority Items Found
              </div>
            </div>
         </div>
      </div>

      {/* Financial Integration Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 glass-card bg-white dark:bg-[#052659] text-slate-800 dark:text-white flex flex-col border-none shadow-2xl p-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 dark:bg-white/5 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-700"></div>
          <h3 className="label-xs text-slate-400 dark:text-blue-300/40 mb-8 font-bold italic tracking-wider">{t('activity_log')}</h3>
          <div className="flex-1 space-y-6 relative z-10">
            <ActivityItem color="bg-blue-500" title="Stock Sync: Google Sheets" sub="5 minutes ago • Success" />
            <ActivityItem color="bg-red-500" title="Low Stock Warning: Milk" sub="System-generated • Critical" />
            <ActivityItem color="bg-slate-500" title="Back Office Manual Entry" sub="Yesterday, 18:10 • Admin: Sisavanh" />
          </div>
        </div>

        <div className="lg:col-span-2 high-density-card p-0 overflow-hidden flex flex-col border-none shadow-2xl">
           <div className="p-5 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 flex justify-between items-center">
              <h3 className="label-xs flex items-center gap-2">
                 <History className="w-3 h-3 text-slate-400" />
                 Recent Data Movement
              </h3>
              <button 
                onClick={() => setShowMovementsModal(true)}
                className="text-[9px] font-black uppercase text-primary hover:underline flex items-center gap-1"
              >
                View Full Matrix
                <ChevronRight className="w-2.5 h-2.5" />
              </button>
           </div>
           <div className="flex-1 overflow-x-auto">
              <table className="w-full text-[11px]">
                 <thead className="text-slate-400 bg-slate-50/50 dark:bg-white/5">
                    <tr>
                       <th className="text-left p-4 p-5 font-bold uppercase tracking-widest">{t('item_name')}</th>
                       <th className="text-left p-4 p-5 font-bold uppercase tracking-widest">Action</th>
                       <th className="text-left p-4 p-5 font-bold uppercase tracking-widest">Qty</th>
                       <th className="text-right p-4 p-5 font-bold uppercase tracking-widest">Timestamp</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {[...rawMovements].reverse().slice(0, 50).map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold text-primary dark:text-white uppercase truncate max-w-[200px]">{m.item}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-black ${m.type === 'IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {m.type === 'IN' ? 'INVENTORY IN' : 'INVENTORY OUT'}
                          </span>
                        </td>
                        <td className="p-4 font-black">{m.type === 'IN' ? '+' : '-'}{m.quantity}</td>
                        <td className="p-4 text-right text-slate-400 font-mono italic">{m.date}</td>
                      </tr>
                    ))}
                    {rawMovements.length === 0 && (
                      <tr><td colSpan={4} className="p-10 text-center text-[10px] font-bold text-slate-400 uppercase italic">No movement recorded in Matrix</td></tr>
                    )}
                 </tbody>
              </table>
           </div>
        </div>
      </div>

      {/* Modals */}
      {showInventoryModal && (
        <MatrixModal 
          title="Consolidated Inventory Matrix" 
          onClose={() => {
            setShowInventoryModal(false);
            setSearchQuery('');
          }}
        >
          <div className="mb-6 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search Items..." 
                className="crystal-input !pl-10 !py-2 !text-xs w-full"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-100 dark:border-white/5 rounded-2xl">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 dark:bg-white/5 text-slate-400 font-black uppercase tracking-widest">
                <tr>
                  <th className="p-4">Item Identity</th>
                  <th className="p-4 text-center">Total In</th>
                  <th className="p-4 text-center">Total Out</th>
                  <th className="p-4 text-right">Current Balance</th>
                  <th className="p-4 text-right">Min Stock</th>
                  <th className="p-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-bold text-slate-900 dark:text-white">
                {inventoryBalances
                  .filter(inv => inv.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((inv, idx) => {
                    const isCritical = inv.current <= inv.minStock;
                    return (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                      <td className="p-4 uppercase">{inv.name}</td>
                      <td className="p-4 text-center text-emerald-500 font-mono">+{inv.totalIn}</td>
                      <td className="p-4 text-center text-rose-500 font-mono">-{inv.totalOut}</td>
                      <td className="p-4 text-right font-black text-xs">{inv.current}</td>
                      <td className="p-4 text-right text-slate-400">{inv.minStock}</td>
                      <td className="p-4 text-right">
                         <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            isCritical ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
                         }`}>
                           {isCritical ? 'REPLENISH' : 'OPTIMAL'}
                         </span>
                      </td>
                    </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </MatrixModal>
      )}

      {showMovementsModal && (
        <MatrixModal 
          title="Data Movement History" 
          onClose={() => {
            setShowMovementsModal(false);
            setSearchQuery('');
          }}
        >
          <div className="mb-6 flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search History..." 
                className="crystal-input !pl-10 !py-2 !text-xs w-full"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-100 dark:border-white/5 rounded-2xl">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 dark:bg-white/5 text-slate-400 font-black uppercase tracking-widest">
                <tr>
                  <th className="p-4">Date Identification</th>
                  <th className="p-4">Matrix Entity</th>
                  <th className="p-4 text-center">Movement Type</th>
                  <th className="p-4 text-right">Delta (Quantity)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-bold text-slate-900 dark:text-white">
                {rawMovements
                  .filter(m => m.item.toLowerCase().includes(searchQuery.toLowerCase()))
                  .reverse()
                  .map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                      <td className="p-4 text-slate-400 font-mono uppercase">{m.date}</td>
                      <td className="p-4 uppercase">{m.item}</td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${
                          m.type === 'IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {m.type}
                        </span>
                      </td>
                      <td className={`p-4 text-right text-xs font-black ${m.type === 'IN' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {m.type === 'IN' ? '+' : '-'}{m.quantity}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </MatrixModal>
      )}
    </div>
  );
}

function MatrixModal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#052659]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-[#0a0a0a] w-full max-w-4xl max-h-[90vh] rounded-[2rem] border border-white/20 shadow-2xl overflow-hidden flex flex-col scale-in animate-in zoom-in-95 duration-300">
        <div className="p-6 border-b border-slate-100 dark:border-white/5 flex justify-between items-center bg-slate-50/50 dark:bg-white/5">
           <div>
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#052659] dark:text-white">{title}</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase mt-1 italic tracking-widest">Real-time Data Sink Visibility</p>
           </div>
           <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-200 dark:hover:bg-white/10 rounded-full transition-colors text-slate-400"
           >
              <X className="w-5 h-5" />
           </button>
        </div>
        <div className="flex-1 overflow-y-auto p-8">
           {children}
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ color, title, sub }: any) {
  return (
    <div className="flex gap-4 group">
      <div className={`w-1.5 h-10 ${color} rounded-full transition-transform group-hover:scale-y-110`}></div>
      <div>
        <p className="text-[11px] font-bold text-slate-900 dark:text-white leading-tight uppercase tracking-wide">{title}</p>
        <p className="text-[10px] text-slate-500 dark:text-white/60 font-medium mt-1">{sub}</p>
      </div>
    </div>
  );
}
