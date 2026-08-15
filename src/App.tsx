import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Truck, 
  Wallet, 
  Settings as SettingsIcon, 
  Menu, 
  X, 
  LogOut,
  Moon,
  Sun,
  Globe,
  AlertCircle,
  ShieldAlert,
  Check,
  Coffee,
  PawPrint,
  Eye,
  EyeOff,
  Sparkles,
  Store,
  MapPin,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  PieChart,
  Receipt
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp, collection, query, where, orderBy, limit, deleteDoc } from 'firebase/firestore';
import './i18n';

// Components
import Dashboard from './components/Dashboard';
import Suppliers from './components/Suppliers';
import Financials from './components/Financials';
import Settings from './components/Settings';
import PinModal from './components/PinModal';
import ProcurementPlanner from './components/ProcurementPlanner';
import FinanceReport from './components/FinanceReport';
import DebtLedger from './components/DebtLedger';

// Premium Text Logo Component
const TextLogo = ({ centered = false, dark = false, name = "La Dolce" }: { centered?: boolean, dark?: boolean, name?: string | null }) => (
  <div className={`flex flex-col ${centered ? 'items-center text-center' : 'items-start text-left'} gap-2 group`}>
    <h1 className={`text-5xl font-alice tracking-tight leading-none ${dark ? 'text-white' : 'text-[#052659] dark:text-white'}`}>
      {name || "La Dolce"}
    </h1>
    
    <div className="flex items-center justify-center gap-3 w-full">
      <div className={`h-[1px] flex-1 min-w-[12px] opacity-20 ${dark ? 'bg-white' : 'bg-[#052659]'}`}></div>
      <span className={`text-[9px] font-sans font-black uppercase tracking-[0.5em] ${dark ? 'text-white/60' : 'text-[#052659]/60 dark:text-white/40'}`}>
        Workspace
      </span>
      <div className={`h-[1px] flex-1 min-w-[12px] opacity-20 ${dark ? 'bg-white' : 'bg-[#052659]'}`}></div>
    </div>
    
    <div className={`text-[8px] font-sans font-bold uppercase tracking-[0.8em] opacity-30 mt-1 ${dark ? 'text-white' : 'text-[#052659] dark:text-white'}`}>
       estd 2026
    </div>
  </div>
);

export default function App() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    }
    return false;
  });
  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };
  const [isFinancialUnlocked, setIsFinancialUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinModalMode, setPinModalMode] = useState<'verify' | 'setup'>('verify');
  const [userSettings, setUserSettings] = useState<any>(null);
  const [adminData, setAdminData] = useState<any>(null);
  const [appConfig, setAppConfig] = useState<any>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [activeApprovalRequest, setActiveApprovalRequest] = useState<any>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isDemoLocal, setIsDemoLocal] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const isDemoLocalRef = useRef(false);

  useEffect(() => {
    isDemoLocalRef.current = isDemoLocal;
  }, [isDemoLocal]);

  const [selectedBranch, setSelectedBranch] = useState<'branch_1' | 'branch_2'>(() => {
    return (localStorage.getItem('selected_branch') as any) || 'branch_1';
  });

  const [scannedBillData, setScannedBillData] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyBillParam = params.get('verifyBill');
    if (verifyBillParam) {
      try {
        const decoded = decodeURIComponent(escape(atob(verifyBillParam)));
        const parsed = JSON.parse(decoded);
        setScannedBillData(parsed);
      } catch (e) {
        try {
          const decoded = atob(verifyBillParam);
          const parsed = JSON.parse(decoded);
          setScannedBillData(parsed);
        } catch (err) {
          console.error("Base64 decode failed", err);
        }
      }
    }
  }, []);

  const FOUNDING_ADMINS = ['sisavanhbouddasien@gmail.com', 'tonickbouddasien@gmail.com'];
  const isSuperAdmin = adminData?.role === 'super_admin' || (user?.email && FOUNDING_ADMINS.includes(user.email.toLowerCase()));
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    let settingsUnsubscribe: (() => void) | null = null;
    let adminUnsubscribe: (() => void) | null = null;

    const authUnsubscribe = onAuthStateChanged(auth, (u) => {
      if (isDemoLocalRef.current) return;
      setUser(u);
      
      if (settingsUnsubscribe) {
        settingsUnsubscribe();
        settingsUnsubscribe = null;
      }
      if (adminUnsubscribe) {
        adminUnsubscribe();
        adminUnsubscribe = null;
      }

      if (u) {
        const configRef = doc(db, 'settings', 'appConfig');
        const configUnsub = onSnapshot(configRef, (snap) => {
          if (snap.exists()) setAppConfig(snap.data());
        });

        const adminRef = doc(db, 'admins', u.uid);
        adminUnsubscribe = onSnapshot(adminRef, (snap) => {
          if (snap.exists()) {
            setAdminData(snap.data());
          } else {
            setAdminData(null);
          }
        });

        const settingsRef = doc(db, 'users', u.uid, 'settings', 'main');
        settingsUnsubscribe = onSnapshot(settingsRef, (snap) => {
          if (snap.exists()) {
            setUserSettings(snap.data());
          } else {
            setUserSettings({});
          }
        }, (error) => {
          if (auth.currentUser) {
            handleFirestoreError(error, OperationType.GET, `users/${u.uid}/settings/main`);
          }
        });

        let approvalUnsub: (() => void) | null = null;
        if (FOUNDING_ADMINS.includes(u.email?.toLowerCase() || '')) {
          const q = query(
            collection(db, 'approval_requests'),
            where('status', '==', 'pending'),
            limit(1)
          );
          approvalUnsub = onSnapshot(q, (snap) => {
            if (!snap.empty) {
              const req = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
              setActiveApprovalRequest(req);
            } else {
              setActiveApprovalRequest(null);
            }
          }, (err) => {
            console.error("Approval listener error:", err);
          });
        }

        return () => {
          configUnsub();
          if (adminUnsubscribe) adminUnsubscribe();
          if (settingsUnsubscribe) settingsUnsubscribe();
          if (approvalUnsub) approvalUnsub();
        };
      } else {
        setUserSettings(null);
        setIsFinancialUnlocked(false);
      }
    });

    return () => {
      authUnsubscribe();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const updateActivity = () => setLastActivity(Date.now());
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach(name => document.addEventListener(name, updateActivity));

    const interval = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActivity;
      const FIVE_MINUTES = 5 * 60 * 1000;

      if (isFinancialUnlocked && idleTime > FIVE_MINUTES) {
        setIsFinancialUnlocked(false);
        if (activeTab === 'financials') {
          setActiveTab('dashboard');
        }
      }
    }, 10000);

    return () => {
      events.forEach(name => document.removeEventListener(name, updateActivity));
      clearInterval(interval);
    };
  }, [lastActivity, isFinancialUnlocked, activeTab]);

  const login = async () => {
    setLoginError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err: any) {
      if (err.code === 'auth/unauthorized-domain') setLoginError('unauthorized-domain');
      else if (err.code === 'auth/popup-blocked') setLoginError('popup-blocked');
      else setLoginError(err.message || 'unknown');
    }
  };

  const logout = () => {
    setIsDemoLocal(false);
    signOut(auth);
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#052659] p-4 text-center relative overflow-hidden">
        <div className="glass-card max-w-lg w-full space-y-12 animate-in fade-in zoom-in duration-1000 py-20 px-10 border-slate-200 dark:border-white/5 shadow-2xl relative overflow-hidden">
          <TextLogo centered={true} name={appConfig?.shopName || userSettings?.shopName} />
          <button 
            onClick={login}
            className="crystal-button w-full h-16 flex items-center justify-center gap-4 text-[11px] shadow-none border border-[#052659]/10 dark:border-white/10"
          >
            <Globe className="w-5 h-5 opacity-50" />
            <span className="tracking-[0.2em]">{t('sign_in_google')}</span>
          </button>
        </div>
      </div>
    );
  }

  // ✅ 🧭 ລາຍການເມນູທັງໝົດໃນລະບົບ (ລວມທັງ Report ແລະ Debts AP/AR):
  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('dashboard') },
    { id: 'report', icon: PieChart, label: i18n.language === 'la' ? 'ບົດລາຍງານການເງິນ' : 'Finance Report' },
    { id: 'debts', icon: Receipt, label: i18n.language === 'la' ? 'ໜີ້ຕ້ອງສົ່ງ & ຮັບ (AP/AR)' : 'Debt Ledger' },
    { id: 'suppliers', icon: Truck, label: t('suppliers') },
    { id: 'planner', icon: Sparkles, label: i18n.language === 'la' ? 'ແຜນຈັດຊື້ & ບິນ' : 'Auto-Bill Planner' },
    { id: 'financials', icon: Wallet, label: t('financials'), isSensitive: true },
    { id: 'settings', icon: SettingsIcon, label: t('settings') },
  ];

  const handleTabChange = (item: any) => {
    if (item.isSensitive && !isFinancialUnlocked) {
      if (userSettings?.financialPin) {
        setPinModalMode('verify');
        setShowPinModal(true);
        return;
      } else if (userSettings !== null) {
        setPinModalMode('setup');
        setShowPinModal(true);
        return;
      }
    }
    setActiveTab(item.id);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const handlePinSuccess = async (newPin?: string) => {
    if (pinModalMode === 'setup' && newPin) {
      try {
        await setDoc(doc(db, 'users', user?.uid!, 'settings', 'main'), {
          financialPin: newPin,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) {
        handleFirestoreError(e, OperationType.WRITE, `users/${user?.uid}/settings/main`);
        return;
      }
    }
    setIsFinancialUnlocked(true);
    setShowPinModal(false);
    setActiveTab('financials');
  };

  return (
    <div className="min-h-screen flex transition-colors duration-300">
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-45 lg:hidden animate-in fade-in duration-200"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 bg-[#052659] text-white transition-all duration-300 flex flex-col h-screen
        ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-60'} w-56
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className={`border-b border-white/5 bg-black/5 flex items-center ${isSidebarCollapsed ? 'justify-center px-2 py-4' : 'justify-between p-6'} gap-2 shrink-0`}>
          {!isSidebarCollapsed ? (
            <div className="flex-1 overflow-hidden animate-in fade-in duration-200">
              <TextLogo dark={true} centered={true} name={appConfig?.shopName || userSettings?.shopName} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 border border-white/15 w-12 h-12 shrink-0">
              <span className="text-[16px] font-alice font-bold text-white leading-none">LD</span>
            </div>
          )}
          <button 
            onClick={() => setIsSidebarOpen(false)} 
            className="lg:hidden p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1 mt-4">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleTabChange(item)}
              title={isSidebarCollapsed ? item.label : undefined}
              className={`
                w-full flex items-center ${isSidebarCollapsed ? 'justify-center px-0' : 'justify-start px-4'} py-3 rounded-xl text-[12px] font-bold uppercase tracking-wider transition-all duration-300
                ${activeTab === item.id 
                  ? 'bg-white/10 text-white shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3)] border border-white/10 backdrop-blur-md' 
                  : 'text-white/40 hover:bg-white/5 hover:text-white'}
              `}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!isSidebarCollapsed && (
                <span className="truncate ml-3 animate-in fade-in duration-200">{item.label}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10 bg-black/20 mt-auto shrink-0 flex flex-col gap-4">
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'} overflow-hidden`}>
            <img src={user.photoURL || ''} alt="User" className="w-8 h-8 rounded-full border border-white/20 shrink-0" />
            {!isSidebarCollapsed && (
              <div className="overflow-hidden animate-in fade-in duration-200">
                <p className="text-xs font-bold truncate">{user.displayName}</p>
                <p className="text-[10px] opacity-40 truncate uppercase font-bold tracking-tighter">{t('admin_session')}</p>
              </div>
            )}
          </div>
          
          <div className={`flex ${isSidebarCollapsed ? 'flex-col items-center' : 'items-center'} gap-2`}>
            <button
              onClick={toggleSidebarCollapse}
              className="hidden lg:flex items-center justify-center p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-xl transition-all"
            >
              {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>

            <button 
              onClick={logout}
              className={`flex items-center justify-center gap-2 py-2 text-[11px] font-bold uppercase tracking-widest text-red-300 hover:text-red-400 hover:bg-white/5 rounded-xl transition-all ${isSidebarCollapsed ? 'w-full' : 'flex-1'}`}
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              {!isSidebarCollapsed && <span className="animate-in fade-in duration-200">{t('logout')}</span>}
            </button>
          </div>
        </div>
      </aside>

      <div className={`hidden lg:block transition-all duration-300 shrink-0 ${isSidebarCollapsed ? 'w-20' : 'w-60'}`} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-transparent overflow-hidden">
        <header className="h-14 bg-[#052659] text-white border-b border-white/10 px-4 lg:px-6 flex items-center justify-between sticky top-0 z-40 shadow-md">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 hover:bg-white/10 rounded-lg">
              <Menu className="w-5 h-5 text-white" />
            </button>
            <div className="flex items-center gap-2 text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">
              <span>{t('home')}</span>
              <span className="text-white/20">/</span>
              <span className="text-white/80">{activeTab}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
             <div className="relative group">
               <button className="h-9 px-3 bg-white/10 hover:bg-white/15 active:bg-white/20 rounded-xl flex items-center gap-2 transition-all border border-white/5 shadow-inner">
                 <Store className="w-3.5 h-3.5 text-blue-300" />
                 <span className="text-[10px] font-black uppercase tracking-wider text-white">
                   {selectedBranch === 'branch_1' 
                     ? (i18n.language === 'la' ? 'ສາຂາ 1 (ນະຄອນຫຼວງ)' : 'Branch 1 (Main)') 
                     : (i18n.language === 'la' ? 'ສາຂາ 2 (ຫຼວງພະບາງ)' : 'Branch 2 (LPB)')
                   }
                 </span>
                 <span className="text-[8px] opacity-40">▼</span>
               </button>
               <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-[#073069] border border-slate-100 dark:border-white/10 rounded-2xl shadow-xl py-2 hidden group-hover:block hover:block z-50 text-slate-800 dark:text-white">
                 <button
                   onClick={() => { setSelectedBranch('branch_1'); localStorage.setItem('selected_branch', 'branch_1'); }}
                   className={`w-full text-left px-4 py-2.5 text-xs font-bold flex items-center gap-2 ${selectedBranch === 'branch_1' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}
                 >
                   <MapPin className="w-3.5 h-3.5" />
                   <span>ສາຂາ 1 (ນະຄອນຫຼວງ)</span>
                 </button>
                 <button
                   onClick={() => { setSelectedBranch('branch_2'); localStorage.setItem('selected_branch', 'branch_2'); }}
                   className={`w-full text-left px-4 py-2.5 text-xs font-bold flex items-center gap-2 ${selectedBranch === 'branch_2' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'}`}
                 >
                   <MapPin className="w-3.5 h-3.5" />
                   <span>ສາຂາ 2 (ຫຼວງພະບາງ)</span>
                 </button>
               </div>
             </div>

             <button 
              onClick={() => i18n.changeLanguage(i18n.language === 'la' ? 'en' : 'la')}
              className="p-2 hover:bg-white/10 rounded-md text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
            >
              <Globe className="w-4 h-4 text-white/60" />
              <span className="hidden sm:inline">{i18n.language === 'la' ? 'LA' : 'EN'}</span>
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 hover:bg-white/10 rounded-md text-white flex items-center gap-2"
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-blue-300" />}
            </button>
          </div>
        </header>

        {/* Dynamic Section Container */}
        <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#052659] dark:to-[#073069]">
           <div className="max-w-7xl mx-auto space-y-6">
             {activeTab === 'dashboard' && <Dashboard userSettings={userSettings} user={user} selectedBranch={selectedBranch} />}
             {activeTab === 'report' && <FinanceReport selectedBranch={selectedBranch} />}
             {activeTab === 'debts' && <DebtLedger selectedBranch={selectedBranch} />}
             {activeTab === 'suppliers' && <Suppliers />}
             {activeTab === 'planner' && <ProcurementPlanner selectedBranch={selectedBranch} />}
             {activeTab === 'financials' && <Financials appConfig={appConfig} selectedBranch={selectedBranch} />}
             {activeTab === 'settings' && <Settings user={user} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} userSettings={userSettings} isSuperAdmin={isSuperAdmin} appConfig={appConfig} selectedBranch={selectedBranch} />}
          </div>
        </div>

        <PinModal 
          isOpen={showPinModal} 
          onClose={() => setShowPinModal(false)} 
          correctPin={userSettings?.financialPin}
          mode={pinModalMode}
          onSuccess={handlePinSuccess}
        />
      </main>
    </div>
  );
}
