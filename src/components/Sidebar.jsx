import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  LogOut, 
  Bell, 
  BookOpen, 
  ShieldAlert, 
  ListTodo, 
  Menu, 
  X,
  AlertTriangle,
  Info,
  User
} from 'lucide-react';
import { formatDate } from '../utils/helpers';

export default function Sidebar({ 
  currentTab, 
  setCurrentTab, 
  isOpen, 
  setIsOpen,
  isCollapsed,
  setIsCollapsed,
  viewMode,
  setViewMode,
  notifications = []
}) {
  const { userProfile, logout } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);

  if (!userProfile) return null;

  const roleClassMap = {
    student: 'role-student',
    teacher: 'role-teacher',
    admin: 'role-admin'
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'success': return <CheckCircle size={14} className="text-success" />;
      case 'warning': return <AlertTriangle size={14} className="text-warning" />;
      case 'danger': return <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />;
      default: return <Info size={14} className="text-info" />;
    }
  };

  const navigationItems = [];

  // Add Dashboard panels based on role
  if (userProfile.role === 'admin') {
    navigationItems.push({ id: 'dashboard-admin', tab: 'dashboard', mode: 'admin', label: 'Admin Panel', icon: <ShieldAlert size={18} /> });
    navigationItems.push({ id: 'dashboard-teacher', tab: 'dashboard', mode: 'teacher', label: 'Teacher Panel', icon: <ListTodo size={18} /> });
    navigationItems.push({ id: 'dashboard-student', tab: 'dashboard', mode: 'student', label: 'Student Panel', icon: <BookOpen size={18} /> });
  } else if (userProfile.role === 'teacher') {
    navigationItems.push({ id: 'dashboard-teacher', tab: 'dashboard', mode: 'teacher', label: 'Teacher Panel', icon: <ListTodo size={18} /> });
    navigationItems.push({ id: 'dashboard-student', tab: 'dashboard', mode: 'student', label: 'Student Panel', icon: <BookOpen size={18} /> });
  } else {
    navigationItems.push({ id: 'dashboard-student', tab: 'dashboard', mode: 'student', label: 'Student Dashboard', icon: <BookOpen size={18} /> });
  }

  // Add Profile
  navigationItems.push({ id: 'profile', tab: 'profile', mode: null, label: 'User Center', icon: <User size={18} /> });



  return (
    <>
      {/* Mobile/Desktop Toggle Button */}
      <button 
        className="menu-toggle glass" 
        onClick={() => {
          if (window.innerWidth <= 768) {
            setIsOpen(!isOpen);
          } else {
            setIsCollapsed(!isCollapsed);
          }
        }}
        aria-label="Toggle Navigation"
      >
        {(isOpen || isCollapsed) ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar Panel */}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Identity Badge */}
        <div className="identity-badge">
          <img 
            src={userProfile.photoURL || 'https://via.placeholder.com/150'} 
            alt="Avatar" 
            className="identity-avatar"
            onError={(e) => { e.target.src = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + userProfile.uid; }}
          />
          <div className="identity-info">
            <span className="identity-name">{userProfile.name}</span>
            <span className="identity-email">{userProfile.email}</span>
            <span className={`identity-role ${roleClassMap[userProfile.role]}`}>
              {userProfile.role}
            </span>
          </div>
        </div>


        {/* Navigation Roster */}
        <nav className="nav-menu">
          {navigationItems.map((item) => {
            let isActive = false;
            if (item.tab === 'profile') {
              isActive = currentTab === 'profile';
            } else {
              // For dashboard items, both tab must be 'dashboard' and mode must match viewMode
              const currentMode = viewMode || userProfile.role;
              isActive = currentTab === 'dashboard' && currentMode === item.mode;
            }

            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setCurrentTab(item.tab);
                  if (item.mode) {
                    setViewMode(item.mode);
                  }
                  setIsOpen(false); // Close sidebar on mobile select
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}

          <button 
            className="nav-item logout-btn" 
            onClick={logout}
            style={{ marginTop: 'auto' }}
          >
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </nav>
      </aside>
    </>
  );
}
