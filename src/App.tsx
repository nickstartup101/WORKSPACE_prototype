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
  CheckCircle
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
        console.error("Failed decoding serialized bill UTF-8, attempting standard decode", e);
        try {
          const decoded = atob(verifyBillParam);
          const parsed = JSON.parse(decoded);
          setScannedBillData(parsed);
        } catch (err) {
          console.error("Standard base64 decode failed", err);
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
        console.log('Idle timeout reached: Locking sensitive data');
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
      console.error("Login error:", err);
      if (err.code === 'auth/unauthorized-domain') {
        setLoginError('unauthorized-domain');
      } else if (err.code === 'auth/popup-blocked') {
        setLoginError('popup-blocked');
      } else {
        setLoginError(err.message || 'unknown');
      }
    }
  };

  const startLocalDemoMode = () => {
    setIsDemoLocal(true);
    setUser({
      uid: 'demo_guest_user',
      email: 'sisavanhbouddasien@gmail.com',
      displayName: 'Guest Admin (Offline)',
      photoURL: 'https://api.dicebear.com/7.x/adventurer/svg?seed=LaDolceAdmin',
      emailVerified: true,
    } as any);
    setUserSettings({
      financialPin: '1234',
      shopName: 'La Dolce (Demo)',
    });
    setAppConfig({
      shopName: 'La Dolce (Demo)',
    });
    setAdminData({
      role: 'super_admin',
    });
  };

  const loginWithDemoAccount = async () => {
    setDemoLoading(true);
    setLoginError(null);
    const demoEmail = 'guest@ladolce.com';
    const demoPassword = 'ladolcepassword123';
    try {
      await signInWithEmailAndPassword(auth, demoEmail, demoPassword);
    } catch (err: any) {
      console.warn("Demo sign-in failed, checking error code:", err.code);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, demoEmail, demoPassword);
        } catch (createErr: any) {
          console.warn("Auto registration of demo user failed, trying anonymous auth:", createErr);
          try {
            await signInAnonymously(auth);
          } catch (anonErr: any) {
            console.error("Anonymous authentication failed, falling back to local demo mode:", anonErr);
            startLocalDemoMode();
          }
        }
      } else if (err.code === 'auth/operation-not-allowed') {
        try {
          await signInAnonymously(auth);
        } catch (anonErr: any) {
          console.error("Anonymous authentication failed, falling back to local demo mode:", anonErr);
          startLocalDemoMode();
        }
      } else {
        console.error("Unexpected authentication error, falling back to local demo mode:", err);
        startLocalDemoMode();
      }
    } finally {
      setDemoLoading(false);
    }
  };

  const logout = () => {
    setIsDemoLocal(false);
    signOut(auth);
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#052659] p-4 text-center relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse"></div>
        
        <div className="glass-card max-w-lg w-full space-y-12 animate-in fade-in zoom-in duration-1000 py-20 px-10 border-slate-200 dark:border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>
          
          <TextLogo centered={true} name={appConfig?.shopName || userSettings?.shopName} />
          
          <div className="pt-8 space-y-6">
            {loginError && (
              <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-left space-y-2 animate-in fade-in duration-300">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-black text-rose-500 uppercase tracking-widest">
                      {i18n.language === 'la' ? 'ພົບຂໍ້ຜິດພາດໃນການເຂົ້າລະບົບ' : 'Sign-In Error'}
                    </p>
                    {loginError === 'unauthorized-domain' ? (
                      <p className="text-[10px] text-[#fca5a5] leading-normal">
                        {i18n.language === 'la' 
                          ? "ໂດເມນນີ້ຍັງບໍ່ຖືກອະນຸຍາດ: ກະລຸນາເພີ່ມ URL ນີ້ເຂົ້າໃນ 'Authentication > Settings > Authorized domains' ໃນ Firebase Console."
                          : "This domain is not authorized. Please add this URL to the Firebase Console's 'Authorized domains' section."}
                      </p>
                    ) : loginError === 'popup-blocked' ? (
                      <p className="text-[10px] text-[#fca5a5] leading-normal">
                        <strong>
                          {i18n.language === 'la'
                            ? "ໜ້າຕ່າງປ໊ອບອັບຖືກບລັອກ (Popup Blocked)"
                            : "Your browser has blocked the login popup."}
                        </strong>
                        <br />
                        {i18n.language === 'la'
                          ? "ກະລຸນາກົດປຸ່ມ 'ເປີດໃນແທັບໃໝ່' (Open in New Tab) ຢູ່ເບື້ອງເທິງຂວາເພື່ອໂຫຼດແອັບໃນແທັບຫຼັກ ແລ້ວລອງເຂົ້າລະບົບຄືນໃໝ່."
                          : "Please click the 'Open in New Tab' button in the top-right corner to open the app directly and complete Google log-in."}
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#fca5a5] leading-normal">
                        {loginError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-4 text-[#052659]/30 dark:text-white/20">
              <div className="h-[1px] flex-1 bg-current"></div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] whitespace-nowrap">{t('shop_architecture')}</p>
              <div className="h-[1px] flex-1 bg-current"></div>
            </div>
            
            <button 
              onClick={login}
              className="crystal-button w-full h-16 flex items-center justify-center gap-4 text-[11px] shadow-none border border-[#052659]/10 dark:border-white/10"
            >
              <Globe className="w-5 h-5 opacity-50" />
              <span className="tracking-[0.2em]">{t('sign_in_google')}</span>
            </button>

            <button 
              onClick={loginWithDemoAccount}
              disabled={demoLoading}
              className="w-full h-14 rounded-2xl flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.15em] bg-blue-500/10 hover:bg-blue-500/15 active:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition-all duration-300 disabled:opacity-50 shadow-lg shadow-blue-500/5 mt-4"
            >
              {demoLoading ? (
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-blue-400 border-t-transparent" />
              ) : (
                <Sparkles className="w-4 h-4 text-blue-400" />
              )}
              <span>
                {demoLoading 
                  ? (i18n.language === 'la' ? 'ກຳລັງໂຫຼດລະບົບ...' : 'Loading system...')
                  : (i18n.language === 'la' ? 'ເຂົ້າລະບົບດ່ວນ (Demo / ບໍ່ມີປ໊ອບອັບ)' : 'Direct Access (Demo / Guest)')
                }
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ✅ Navigation Items without HR
  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('dashboard') },
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
      {/* Mobile sidebar overlay blur backdrop */}
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
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 border border-white/15 shadow-[0_4px_12px_rgba(0,0,0,0.15)] w-12 h-12 shrink-0 animate-in zoom-in-95 duration-200">
              <span className="text-[16px] font-alice font-bold text-white leading-none">LD</span>
              <span className="text-[6px] font-sans font-black uppercase tracking-widest text-blue-400 mt-1.5 leading-none">WS</span>
            </div>
          )}
          <button 
            onClick={() => setIsSidebarOpen(false)} 
            className="lg:hidden p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition-all"
            aria-label="Close sidebar"
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
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <div className="flex items-center gap-1 text-white/45 hover:text-white">
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-[9px] font-bold uppercase tracking-wider">{i18n.language === 'la' ? 'ພັບເມນູ' : 'Collapse'}</span>
                </div>
              )}
            </button>

            <button 
              onClick={logout}
              className={`flex items-center justify-center gap-2 py-2 text-[11px] font-bold uppercase tracking-widest text-red-300 hover:text-red-400 hover:bg-white/5 rounded-xl transition-all ${isSidebarCollapsed ? 'w-full' : 'flex-1'}`}
              title={t('logout')}
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              {!isSidebarCollapsed && <span className="animate-in fade-in duration-200">{t('logout')}</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Desktop sidebar spacer */}
      <div className={`hidden lg:block transition-all duration-300 shrink-0 ${isSidebarCollapsed ? 'w-20' : 'w-60'}`} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-transparent overflow-hidden">
        {/* Top bar */}
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
             {user && !user.emailVerified && (
               <div className="hidden md:flex items-center gap-1 px-2 py-1 bg-amber-500/10 text-amber-400 text-[9px] font-bold rounded-md uppercase tracking-tighter" title={t('unverified_warning')}>
                 <AlertCircle className="w-3 h-3" />
                 {t('unverified_warning').split('.')[0]}
               </div>
             )}

             {/* Dynamic Multi-Branch Selector */}
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
               <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-[#073069] border border-slate-100 dark:border-white/10 rounded-2xl shadow-xl py-2 hidden group-hover:block hover:block animate-in fade-in slide-in-from-top-1 duration-200 z-50 text-slate-800 dark:text-white">
                 <p className="px-4 py-1.5 text-[8px] uppercase tracking-widest font-black text-slate-400 dark:text-blue-300/40 border-b border-slate-50 dark:border-white/5 mb-1">
                   {i18n.language === 'la' ? 'ເລືອກສາຂາຈັດການ' : 'Select Branch'}
                 </p>
                 <button
                   onClick={() => {
                     setSelectedBranch('branch_1');
                     localStorage.setItem('selected_branch', 'branch_1');
                   }}
                   className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-colors flex items-center gap-2 ${
                     selectedBranch === 'branch_1' 
                       ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' 
                       : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
                   }`}
                 >
                   <MapPin className={`w-3.5 h-3.5 ${selectedBranch === 'branch_1' ? 'text-blue-500' : 'opacity-40'}`} />
                   <div className="flex flex-col">
                     <span className="leading-tight">{i18n.language === 'la' ? 'ສາຂາ 1 (ນະຄອນຫຼວງ)' : 'Branch 1 (VTE)'}</span>
                     <span className="text-[8px] opacity-50 font-normal">{i18n.language === 'la' ? 'ສາຂາຫຼັກ' : 'Primary Main Store'}</span>
                   </div>
                 </button>
                 <button
                   onClick={() => {
                     setSelectedBranch('branch_2');
                     localStorage.setItem('selected_branch', 'branch_2');
                   }}
                   className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-colors flex items-center gap-2 ${
                     selectedBranch === 'branch_2' 
                       ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300' 
                       : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'
                   }`}
                 >
                   <MapPin className={`w-3.5 h-3.5 ${selectedBranch === 'branch_2' ? 'text-blue-500' : 'opacity-40'}`} />
                   <div className="flex flex-col">
                     <span className="leading-tight">{i18n.language === 'la' ? 'ສາຂາ 2 (ຫຼວງພະບາງ)' : 'Branch 2 (LPB)'}</span>
                     <span className="text-[8px] opacity-50 font-normal">{i18n.language === 'la' ? 'ສາຂາໃໝ່' : 'Luang Prabang'}</span>
                   </div>
                 </button>
               </div>
             </div>

             <button 
              onClick={() => i18n.changeLanguage(i18n.language === 'la' ? 'en' : 'la')}
              className="p-2 hover:bg-white/10 rounded-md text-white flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
              title="Change Language"
            >
              <Globe className="w-4 h-4 text-white/60" />
              <span className="hidden sm:inline">{i18n.language === 'la' ? 'LA' : 'EN'}</span>
            </button>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 hover:bg-white/10 rounded-md text-white flex items-center gap-2"
            >
              {isDarkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-blue-300" />}
              <span className="text-[9px] font-black uppercase opacity-40">{isDarkMode ? 'NIGHT' : 'DAY'}</span>
            </button>
          </div>
        </header>

        {/* Dynamic Section Container */}
        <div className="flex-1 p-4 lg:p-6 overflow-y-auto bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#052659] dark:to-[#073069]">
           <div className="max-w-7xl mx-auto space-y-6">
             {activeTab === 'dashboard' && <Dashboard userSettings={userSettings} user={user} selectedBranch={selectedBranch} />}
             {activeTab === 'suppliers' && <Suppliers />}
             {activeTab === 'planner' && <ProcurementPlanner selectedBranch={selectedBranch} />}
             {activeTab === 'financials' && <Financials appConfig={appConfig} selectedBranch={selectedBranch} />}
             {activeTab === 'settings' && <Settings user={user} isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} userSettings={userSettings} isSuperAdmin={isSuperAdmin} appConfig={appConfig} selectedBranch={selectedBranch} />}
          </div>
        </div>

        {/* Scanned/Verified Bill QR Modal */}
        <AnimatePresence>
          {scannedBillData && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-slate-900 text-slate-850 dark:text-white border border-slate-100 dark:border-white/10 rounded-[2.5rem] p-6 md:p-8 max-w-md w-full shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-32 bg-emerald-500/10 dark:bg-emerald-500/5 -z-10 blur-xl"></div>
                
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center shadow-lg relative border border-emerald-500/20">
                    <CheckCircle className="w-9 h-9" />
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                      {i18n.language === 'la' ? 'ກວດສອບຄວາມຖືກຕ້ອງແລ້ວ' : 'Voucher Verified'}
                    </h2>
                    <p className="text-[10px] uppercase font-mono font-black text-emerald-600 dark:text-emerald-400 tracking-widest bg-emerald-500/10 px-2.5 py-1 rounded-full inline-block">
                      ✓ Authentic Restock Plan
                    </p>
                  </div>

                  {/* Bill Details */}
                  <div className="w-full bg-slate-50 dark:bg-slate-950/40 p-4 rounded-3xl border border-slate-100 dark:border-white/5 space-y-3.5 text-xs text-left">
                    <div className="border-b border-dashed border-slate-200 dark:border-white/10 pb-2">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Order Verification ID</p>
                      <p className="font-mono text-[11px] font-black text-slate-950 dark:text-white">
                        {scannedBillData.rid || 'N/A'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Supplier</p>
                        <p className="font-black text-slate-900 dark:text-white capitalize">
                          {scannedBillData.sup || 'Corporate'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Date Generated</p>
                        <p className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          {scannedBillData.date || 'N/A'}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-white/5">
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-2">Commodities & Quantities</p>
                      <div className="space-y-2 max-h-[140px] overflow-y-auto">
                        {scannedBillData.items && scannedBillData.items.length > 0 ? (
                          scannedBillData.items.map((it: any, i: number) => (
                            <div key={i} className="flex justify-between items-center p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-150/50 dark:border-white/5">
                              <span className="font-bold text-slate-800 dark:text-slate-200 truncate pr-2 max-w-[180px]">
                                {it.n}
                              </span>
                              <span className="font-mono font-black text-sky-500 whitespace-nowrap text-[11px]">
                                {it.q} {it.u === 'PACK' ? (i18n.language === 'la' ? 'ແພັກ' : 'Packs') : (it.u === 'BOX' && i18n.language === 'la' ? 'ກ່ອງ' : it.u)}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="text-[10px] text-slate-400 italic">No item list specified</p>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-3 border-t border-dashed border-slate-200 dark:border-white/10 text-[13px] font-black uppercase text-slate-900 dark:text-white">
                      <span>Estimated Total:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                        {scannedBillData.tot ? Math.round(Number(scannedBillData.tot)).toLocaleString() : '0'} ₭
                      </span>
                    </div>
                  </div>

                  <p className="text-[9.5px] text-slate-400 text-center leading-normal">
                    {i18n.language === 'la'
                      ? 'ໃບບິນນີ້ໄດ້ຮັບອະນຸຍາດ ແລະ ກວດສອບຄວາມຖືກຕ້ອງຢ່າງເປັນທາງການຜ່ານລະບົບ La Dolce Workspace ສາງ ແລະ ການຈັດຊື້.'
                      : 'This document is security certified and verified compliant by the La Dolce cloud accounting & inventory gateway.'}
                  </p>

                  <div className="w-full pt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const newUrl = window.location.origin + window.location.pathname;
                        window.history.replaceState({}, document.title, newUrl);
                        setScannedBillData(null);
                      }}
                      className="w-full py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-950 font-black uppercase tracking-widest text-xs rounded-2xl cursor-pointer duration-150 h-11 flex items-center justify-center shadow-lg"
                    >
                      {i18n.language === 'la' ? '✕ ປິດການກວດສອບ' : '✕ Dismiss Verification'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <PinModal 
          isOpen={showPinModal} 
          onClose={() => setShowPinModal(false)} 
          correctPin={userSettings?.financialPin}
          mode={pinModalMode}
          onSuccess={handlePinSuccess}
        />

        {/* Global Approval Notification */}
        <AnimatePresence>
          {activeApprovalRequest && isSuperAdmin && (
            <motion.div
              initial={{ y: -100, opacity: 0 }}
              animate={{ y: 20, opacity: 1 }}
              exit={{ y: -100, opacity: 0 }}
              className="fixed top-0 left-1/2 -translate-x-1/2 z-[200] w-[95%] max-w-sm"
            >
              <div className="bg-white dark:bg-[#0a3a82] text-slate-900 dark:text-white p-6 rounded-[2.5rem] shadow-[0_30px_60px_rgba(5,38,89,0.2)] border border-[#052659]/5 flex flex-col gap-4 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#052659]/5 rounded-full -mr-16 -mt-16"></div>
                
                <div className="flex items-center gap-4 relative z-10">
                  <div className="w-14 h-14 bg-[#052659]/5 dark:bg-white/10 rounded-2xl flex items-center justify-center flex-shrink-0 relative">
                     <ShieldAlert className="w-7 h-7 text-[#052659] dark:text-blue-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#052659]/40 dark:text-blue-300/40 mb-1">Awaiting Approval</p>
                    <p className="text-sm font-black tracking-tight leading-none mb-1 text-[#052659] dark:text-white">{activeApprovalRequest.type?.toUpperCase()}</p>
                    <p className="text-[9px] font-bold opacity-40 truncate">FROM: {activeApprovalRequest.requestedByEmail}</p>
                  </div>
                </div>

                {activeApprovalRequest.data && (
                  <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-2xl border border-slate-100 dark:border-white/5 relative z-10 animate-in fade-in zoom-in duration-300">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#052659]/30 dark:text-white/20 mb-2">Request Details</p>
                    <div className="space-y-1">
                      {Object.entries(activeApprovalRequest.data).map(([key, value]) => (
                        <div key={key} className="flex justify-between text-[11px]">
                          <span className="font-bold uppercase text-[#052659]/60 dark:text-white/40">{key}:</span>
                          <span className="font-black text-[#052659] dark:text-white">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-3 relative z-10">
                  <button 
                    onClick={async () => {
                      try {
                        const ref = doc(db, 'approval_requests', activeApprovalRequest.id);
                        
                        if (activeApprovalRequest.type === 'delete' && activeApprovalRequest.data?.id) {
                          try {
                            await deleteDoc(doc(db, 'supplierPrices', activeApprovalRequest.data.id));
                          } catch (e) {
                            console.error("Direct execution error:", e);
                          }
                        }

                        await setDoc(ref, { 
                          status: 'approved', 
                          approvedBy: user?.email,
                          approvedAt: serverTimestamp() 
                        }, { merge: true });
                        setActiveApprovalRequest(null);
                      } catch (err) {
                        console.error("Approve error:", err);
                        alert("Permission denied or connection error");
                      }
                    }}
                    className="flex-1 h-14 bg-[#052659] hover:bg-[#073069] text-white rounded-2xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-lg font-black uppercase tracking-widest text-[11px]"
                  >
                    <Check className="w-5 h-5" />
                    Approve
                  </button>
                  <button 
                    onClick={async () => {
                      try {
                        const ref = doc(db, 'approval_requests', activeApprovalRequest.id);
                        await setDoc(ref, { 
                          status: 'rejected', 
                          rejectedBy: user?.email,
                          rejectedAt: serverTimestamp() 
                        }, { merge: true });
                        setActiveApprovalRequest(null);
                      } catch (err) {
                        console.error("Reject error:", err);
                        alert("Permission denied or connection error");
                      }
                    }}
                    className="w-14 h-14 bg-white dark:bg-white/5 border border-[#052659]/10 text-[#052659] dark:text-white rounded-2xl flex items-center justify-center hover:bg-slate-50 dark:hover:bg-white/10 hover:scale-[1.02] active:scale-95 transition-all shadow-sm"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
