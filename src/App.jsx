import React, { useEffect, useState } from 'react';
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
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeChatAssignment, setActiveChatAssignment] = useState(null);
  
  // Dynamic collections for notifications calculation
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [notifications, setNotifications] = useState([]);

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

    return () => {
      unsubGroups();
      unsubAssign();
      unsubSubs();
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
      submissions
    });
    setNotifications(computed);
  }, [userProfile, groups, assignments, submissions]);

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

    if (currentTab === 'admin' && userProfile.role === 'admin') {
      return <AdminDashboard />;
    }

    // Default dashboard based on role
    switch (userProfile.role) {
      case 'admin':
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
    <div className="app-container">
      {/* Universal Sidebar */}
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
      />

      {/* Main Panel Viewport */}
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, width: '100%' }}>
        {/* Top Header Bar for Notifications */}
        <header className="top-header glass">
          <div style={{ flexGrow: 1 }}></div>
          <div className="notification-bell-container" style={{ position: 'relative' }}>
            <button 
              className="btn btn-secondary notification-btn" 
              onClick={() => {
                const el = document.getElementById('notif-panel');
                if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none';
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              {notifications.length > 0 && (
                <span className="notification-badge">{notifications.length}</span>
              )}
            </button>

            <div id="notif-panel" className="notifications-panel glass animate-fade-in" style={{ display: 'none', position: 'absolute', right: 0, top: '48px', width: '320px' }}>
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
                notifications.map((alert) => (
                  <div key={alert.id} className="notification-item" style={{ borderLeftColor: alert.type === 'danger' ? 'var(--danger)' : alert.type === 'warning' ? 'var(--warning)' : alert.type === 'success' ? 'var(--success)' : 'var(--primary)' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className="notification-title">{alert.title}</span>
                    </div>
                    <span className="notification-desc">{alert.description}</span>
                  </div>
                ))
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
