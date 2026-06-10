import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import TeacherDashboard from './components/TeacherDashboard';
import StudentDashboard from './components/StudentDashboard';
import UserCenter from './components/UserCenter';
import AssignmentChat from './components/AssignmentChat';
import { calculateNotifications } from './utils/notifications';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';

function MainAppContent() {
  const { currentUser, userProfile, loading } = useAuth();
  
  // Navigation & UI Layout states
  const [currentTab, setCurrentTabRaw] = useState(() => {
    return sessionStorage.getItem('nav_currentTab') || 'dashboard';
  });
  const setCurrentTab = (tab) => {
    sessionStorage.setItem('nav_currentTab', tab);
    setCurrentTabRaw(tab);
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeChatAssignment, setActiveChatAssignment] = useState(null);

  // Theme state
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  // Dynamic collections for notifications calculation
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [chats, setChats] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [dismissedNotifs, setDismissedNotifs] = useState(new Set());
  const [isNotifsLoaded, setIsNotifsLoaded] = useState(false);

  // Dismiss a single notification by its ID
  const handleDismissNotif = (notifId) => {
    setDismissedNotifs(prev => {
      const next = new Set(prev);
      next.add(notifId);
      return next;
    });
  };

  const handleNotifClick = (alert, isDismissed) => {
    if (!isDismissed) handleDismissNotif(alert.id);
    const el = document.getElementById('notif-panel');
    if (el) el.style.display = 'none';

    let groupId = null;
    let assignmentId = null;
    let openChat = false;

    if (alert.id.startsWith('due-soon-') || alert.id.startsWith('overdue-') || alert.id.startsWith('deadline-passed-')) {
      assignmentId = alert.id.split('-').pop();
    } else if (alert.id.startsWith('group-joined-') || alert.id.startsWith('pending-approvals-')) {
      groupId = alert.id.split('-').pop();
    } else if (alert.id.startsWith('chat-')) {
      assignmentId = alert.id.split('-').pop();
      openChat = true;
    }

    let targetAssignment = null;
    if (assignmentId) {
      targetAssignment = assignments.find(a => a.assignmentId === assignmentId);
      if (targetAssignment) {
        groupId = targetAssignment.groupId;
      }
    }

    if (currentTab !== 'dashboard') {
      setCurrentTab('dashboard');
    }

    if (groupId) {
      if (userProfile?.role === 'teacher') {
        sessionStorage.setItem('teacher_activeGroupId', groupId);
      } else if (userProfile?.role === 'student') {
        sessionStorage.setItem('student_activeGroupId', groupId);
      }
      
      window.dispatchEvent(new CustomEvent('dashboardNav', { 
        detail: { groupId, assignmentId } 
      }));
    }

    if (openChat && targetAssignment) {
      setActiveChatAssignment(targetAssignment);
    }
  };

  // Count of unread notifications
  const unreadCount = notifications.filter(n => !dismissedNotifs.has(n.id)).length;

  // Load dismissed notifications from localStorage when user changes
  useEffect(() => {
    if (currentUser?.uid) {
      try {
        const stored = localStorage.getItem(`dismissedNotifs_${currentUser.uid}`);
        if (stored) {
          setDismissedNotifs(new Set(JSON.parse(stored)));
        } else {
          setDismissedNotifs(new Set());
        }
      } catch (e) {
        console.error("Failed to load dismissed notifications", e);
      } finally {
        setIsNotifsLoaded(true);
      }
    } else {
      setIsNotifsLoaded(false);
    }
  }, [currentUser?.uid]);

  // Save dismissed notifications to localStorage whenever they change
  useEffect(() => {
    if (currentUser?.uid && isNotifsLoaded) {
      try {
        localStorage.setItem(`dismissedNotifs_${currentUser.uid}`, JSON.stringify(Array.from(dismissedNotifs)));
      } catch (e) {
        console.error("Failed to save dismissed notifications", e);
      }
    }
  }, [dismissedNotifs, currentUser?.uid, isNotifsLoaded]);

  // Subscribe to real-time collections on auth load to compute alerts
  useEffect(() => {
    if (!currentUser || !userProfile) return;

    // Listen to Groups
    const unsubGroups = onSnapshot(collection(db, 'groups'), (snap) => {
      const list = [];
      snap.forEach(d => list.push({ groupId: d.id, ...d.data() }));
      setGroups(list);
    });

    // Listen to Assignments
    const unsubAssign = onSnapshot(collection(db, 'assignments'), (snap) => {
      const list = [];
      snap.forEach(d => list.push({ assignmentId: d.id, ...d.data() }));
      setAssignments(list);
    });

    // Listen to Submissions (Scoped to avoid permission denial)
    let subQuery;
    if (userProfile.role === 'student') {
      subQuery = query(collection(db, 'submissions'), where('studentId', '==', currentUser.uid));
    } else {
      subQuery = collection(db, 'submissions');
    }
    const unsubSubs = onSnapshot(subQuery, (snap) => {
      const list = [];
      snap.forEach(d => list.push({ submissionId: d.id, ...d.data() }));
      setSubmissions(list);
    });

    // Listen to Chats
    const unsubChats = onSnapshot(collection(db, 'chats'), (snap) => {
      const list = [];
      snap.forEach(d => list.push({ chatId: d.id, ...d.data() }));
      setChats(list);
    });

    return () => {
      unsubGroups();
      unsubAssign();
      unsubSubs();
      unsubChats();
    };
  }, [currentUser, userProfile]);

  // Compute Notifications on state change
  useEffect(() => {
    if (!userProfile) return;
    
    const computed = calculateNotifications({
      role: userProfile.role,
      userId: currentUser.uid,
      groups,
      assignments,
      submissions,
      chats
    });
    setNotifications(computed);
  }, [userProfile, groups, assignments, submissions, chats]);

  if (loading) {
    return (
      <div className="empty-state" style={{ height: '100vh', justifyContent: 'center' }}>
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}>
          &#8635;
        </div>
        <p style={{ fontWeight: 600 }}>Initializing Security Keys & Cloud Infrastructure...</p>
      </div>
    );
  }

  // Not logged in or no profile
  if (!currentUser || !userProfile) {
    return <Login />;
  }

  // Resolve Active Tab Content based on Role
  const renderContent = () => {
    if (currentTab === 'profile') {
      return <UserCenter />;
    }

    // Default dashboard based on role
    switch (userProfile.role) {
      case 'admin':
        return <AdminDashboard />;
      case 'teacher':
        return (
          <TeacherDashboard 
            onOpenChat={(assignment) => setActiveChatAssignment(assignment)} 
          />
        );
      case 'student':
        return (
          <StudentDashboard 
            onOpenChat={(assignment) => setActiveChatAssignment(assignment)} 
          />
        );
      default:
        return (
          <div className="empty-state">
            <p>Access configuration error. Invalid role identifier.</p>
          </div>
        );
    }
  };

  return (
    <div className={`app-container ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Universal Sidebar */}
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        isCollapsed={sidebarCollapsed}
        setIsCollapsed={setSidebarCollapsed}
      />

      {/* Main Panel Viewport */}
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
        {/* Top Header Bar for Notifications */}
        <header className="top-header glass">
          <div style={{ flexGrow: 1 }}></div>

          {/* Theme Toggle */}
          <button 
            className="btn btn-secondary" 
            style={{ padding: '8px', marginRight: '12px' }}
            onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
            title="Toggle Theme"
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="4.22" x2="19.78" y2="5.64"></line></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            )}
          </button>

          <div className="notification-bell-container" style={{ position: 'relative' }}>
            <button 
              className="btn btn-secondary notification-btn" 
              onClick={() => {
                const el = document.getElementById('notif-panel');
                if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              {unreadCount > 0 && (
                <span className="notification-badge">{unreadCount}</span>
              )}
            </button>

            <div id="notif-panel" className="notifications-panel animate-fade-in" style={{ display: 'none', position: 'absolute', right: 0, top: '48px', width: '320px', backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--card-shadow)', zIndex: 1000, padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>Notifications</span>
                <button 
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => { document.getElementById('notif-panel').style.display = 'none'; }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              {notifications.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  No active alerts.
                </div>
              ) : (
                notifications.map((alert) => {
                  const isDismissed = dismissedNotifs.has(alert.id);
                  return (
                    <div 
                      key={alert.id} 
                      className="notification-item" 
                      style={{ 
                        borderLeftColor: alert.type === 'danger' ? 'var(--danger)' : alert.type === 'warning' ? 'var(--warning)' : alert.type === 'success' ? 'var(--success)' : 'var(--primary)',
                        opacity: isDismissed ? 0.5 : 1,
                        cursor: isDismissed ? 'default' : 'pointer'
                      }}
                      onClick={() => handleNotifClick(alert, isDismissed)}
                    >
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className="notification-title">{alert.title}</span>
                        {isDismissed && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>✓ read</span>}
                      </div>
                      <span className="notification-desc">{alert.description}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </header>

        <main className="main-content">
          {renderContent()}
        </main>
      </div>

      {/* Real-time Chat Overlay Modal */}
      {activeChatAssignment && (
        <AssignmentChat 
          assignment={activeChatAssignment} 
          onClose={() => setActiveChatAssignment(null)} 
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
}
