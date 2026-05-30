import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where
} from 'firebase/firestore';

import { 
  Users, 
  BookOpen, 
  FileCheck, 
  Trash2, 
  Calendar, 
  FileArchive, 
  Edit3, 
  X, 
  ChevronRight, 
  Eye
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/helpers';
import JSZip from 'jszip';

export default function AdminDashboard() {
  const { currentUser } = useAuth();
  
  // Tabs
  const [activeTab, setActiveTab] = useState('users');

  // Data State
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [stats, setStats] = useState({ users: 0, groups: 0, assignments: 0, submissions: 0 });

  // UI State
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [zipLoading, setZipLoading] = useState(false);

  // Selection & Editing State
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [showEditGroup, setShowEditGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', passcode: '', isPublic: true });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersList = [];
      usersSnap.forEach(d => usersList.push(d.data()));
      setUsers(usersList);

      // Fetch Groups (ALL groups from ALL teachers)
      const groupsSnap = await getDocs(collection(db, 'groups'));
      const groupsList = [];
      groupsSnap.forEach(d => groupsList.push({ groupId: d.id, ...d.data() }));
      setGroups(groupsList);

      // Fetch Assignments
      const assignmentsSnap = await getDocs(collection(db, 'assignments'));
      const assignmentsList = [];
      assignmentsSnap.forEach(d => assignmentsList.push({ assignmentId: d.id, ...d.data() }));
      setAssignments(assignmentsList);

      // Fetch Submissions
      const submissionsSnap = await getDocs(collection(db, 'submissions'));
      const submissionsList = [];
      submissionsSnap.forEach(d => submissionsList.push({ submissionId: d.id, ...d.data() }));
      setSubmissions(submissionsList);

      setStats({
        users: usersSnap.size,
        groups: groupsSnap.size,
        assignments: assignmentsSnap.size,
        submissions: submissionsSnap.size
      });
    } catch (error) {
      console.error("Error loading admin data:", error);
      setErrorMessage("Failed to load dashboard data. Check database permissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Run asynchronously to prevent synchronous setState warning
    setTimeout(() => {
      fetchData();
    }, 0);
  }, [fetchData]);

  // Build uid -> user profile lookup
  const usersMap = {};
  users.forEach(u => { usersMap[u.uid] = u; });

  // ─── User Management ───────────────────────────────────────────

  const handleUpdateRole = async (targetUid, newRole) => {
    if (actionLoading) return;
    setActionLoading(true);
    setErrorMessage('');
    
    try {
      const userRef = doc(db, 'users', targetUid);
      await updateDoc(userRef, { role: newRole });
      setUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error(err);
      setErrorMessage("Failed to update user role.");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePurgeUser = async (targetUser) => {
    const confirmMessage = `WARNING: Are you absolutely sure you want to delete and PURGE "${targetUser.name}" (${targetUser.role})?\nThis will permanently delete all associated files, chat logs, submissions, and records. This action is irreversible.`;
    if (!window.confirm(confirmMessage)) return;

    setActionLoading(true);
    setErrorMessage('');
    const targetUid = targetUser.uid;

    try {
      if (targetUser.role === 'student') {
        // --- STUDENT PURGE SEQUENCE ---
        const subQuery = query(collection(db, 'submissions'), where('studentId', '==', targetUid));
        const subSnap = await getDocs(subQuery);
        
        for (const subDoc of subSnap.docs) {
          const subData = subDoc.data();
          if (subData.backendFilename) {
            try {
              await fetch(`${import.meta.env.VITE_API_URL}/api/files/${subData.backendFilename}`, { method: 'DELETE' });
            } catch (backendErr) {
              console.warn(`Backend file delete warning: ${backendErr.message}`);
            }
          }
          await deleteDoc(subDoc.ref);
        }

        // Remove student UID from all group members and pendingApprovals lists
        const groupsSnap = await getDocs(collection(db, 'groups'));
        for (const groupDoc of groupsSnap.docs) {
          const groupData = groupDoc.data();
          let updated = false;
          let members = groupData.members || [];
          let pendingApprovals = groupData.pendingApprovals || [];

          if (members.includes(targetUid)) {
            members = members.filter(uid => uid !== targetUid);
            updated = true;
          }
          if (pendingApprovals.includes(targetUid)) {
            pendingApprovals = pendingApprovals.filter(uid => uid !== targetUid);
            updated = true;
          }

          if (updated) {
            await updateDoc(groupDoc.ref, { members, pendingApprovals });
          }
        }

        await deleteDoc(doc(db, 'users', targetUid));

      } else if (targetUser.role === 'teacher') {
        // --- TEACHER PURGE SEQUENCE ---
        const groupQuery = query(collection(db, 'groups'), where('ownerId', '==', targetUid));
        const groupSnap = await getDocs(groupQuery);

        for (const groupDoc of groupSnap.docs) {
          const groupId = groupDoc.id;

          const assignQuery = query(collection(db, 'assignments'), where('groupId', '==', groupId));
          const assignSnap = await getDocs(assignQuery);

          for (const assignDoc of assignSnap.docs) {
            const assignmentId = assignDoc.id;

            const subQuery = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId));
            const subSnap = await getDocs(subQuery);

            for (const subDoc of subSnap.docs) {
              const subData = subDoc.data();
              if (subData.backendFilename) {
                try {
                  await fetch(`${import.meta.env.VITE_API_URL}/api/files/${subData.backendFilename}`, { method: 'DELETE' });
                } catch (backendErr) {
                  console.warn(`Backend file delete warning: ${backendErr.message}`);
                }
              }
              await deleteDoc(subDoc.ref);
            }

            const chatQuery = query(collection(db, 'chats'), where('assignmentId', '==', assignmentId));
            const chatSnap = await getDocs(chatQuery);
            for (const chatDoc of chatSnap.docs) {
              await deleteDoc(chatDoc.ref);
            }

            await deleteDoc(assignDoc.ref);
          }

          await deleteDoc(groupDoc.ref);
        }

        await deleteDoc(doc(db, 'users', targetUid));
      } else {
        await deleteDoc(doc(db, 'users', targetUid));
      }

      await fetchData();
    } catch (err) {
      console.error("Purge failure:", err);
      setErrorMessage(`Failed to fully purge user: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Group Management ──────────────────────────────────────────

  const handleUpdateGroup = async (e) => {
    e.preventDefault();
    if (!groupForm.name || !groupForm.passcode) return;
    setActionLoading(true);
    setErrorMessage('');

    try {
      const groupRef = doc(db, 'groups', showEditGroup.groupId);
      await updateDoc(groupRef, {
        name: groupForm.name.trim(),
        description: groupForm.description,
        passcode: groupForm.passcode,
        isPublic: groupForm.isPublic
      });
      
      const updatedData = { ...groupForm, name: groupForm.name.trim() };
      setGroups(prev => prev.map(g => g.groupId === showEditGroup.groupId ? { ...g, ...updatedData } : g));
      if (selectedGroup?.groupId === showEditGroup.groupId) {
        setSelectedGroup(prev => ({ ...prev, ...updatedData }));
      }
      
      setShowEditGroup(null);
    } catch (err) {
      console.error(err);
      setErrorMessage("Failed to update group.");
    } finally {
      setActionLoading(false);
    }
  };

  const openEditGroup = (g) => {
    setGroupForm({
      name: g.name,
      description: g.description || '',
      passcode: g.passcode || '',
      isPublic: g.isPublic !== undefined ? g.isPublic : true
    });
    setShowEditGroup(g);
  };

  const handleDeleteGroup = async (group) => {
    const confirmMsg = `DESTRUCTIVE: Delete group "${group.name}" and ALL its assignments, submissions, chat logs, and storage files?\n\nThis action is permanent and irreversible.`;
    if (!window.confirm(confirmMsg)) return;

    setActionLoading(true);
    setErrorMessage('');

    try {
      const groupId = group.groupId;

      // 1. Delete all assignments in this group and their cascading data
      const assignQuery = query(collection(db, 'assignments'), where('groupId', '==', groupId));
      const assignSnap = await getDocs(assignQuery);

      for (const assignDoc of assignSnap.docs) {
        const assignmentId = assignDoc.id;

        // Delete submissions and storage files
        const subQuery = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId));
        const subSnap = await getDocs(subQuery);

        for (const subDoc of subSnap.docs) {
          const subData = subDoc.data();
          if (subData.backendFilename) {
            try {
              await fetch(`${import.meta.env.VITE_API_URL}/api/files/${subData.backendFilename}`, { method: 'DELETE' });
            } catch (backendErr) {
              console.warn(`Backend file delete warning: ${backendErr.message}`);
            }
          }
          await deleteDoc(subDoc.ref);
        }

        // Delete chat messages
        const chatQuery = query(collection(db, 'chats'), where('assignmentId', '==', assignmentId));
        const chatSnap = await getDocs(chatQuery);
        for (const chatDoc of chatSnap.docs) {
          await deleteDoc(chatDoc.ref);
        }

        await deleteDoc(assignDoc.ref);
      }

      // 2. Delete the group itself
      await deleteDoc(doc(db, 'groups', groupId));

      // 3. Clear selection if deleted group was selected
      if (selectedGroup?.groupId === groupId) {
        setSelectedGroup(null);
      }

      await fetchData();
    } catch (err) {
      console.error("Group deletion failed:", err);
      setErrorMessage(`Failed to delete group: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Assignment Management ─────────────────────────────────────

  const handleDeleteAssignment = async (assignment) => {
    const confirmMsg = `DESTRUCTIVE: Delete assignment "${assignment.name}" and ALL its submissions, storage files, and chat history?\n\nThis action is permanent and irreversible.`;
    if (!window.confirm(confirmMsg)) return;

    setActionLoading(true);
    setErrorMessage('');

    try {
      const assignmentId = assignment.assignmentId;

      // Delete submissions and storage files
      const subQuery = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId));
      const subSnap = await getDocs(subQuery);

      for (const subDoc of subSnap.docs) {
        const subData = subDoc.data();
        if (subData.backendFilename) {
          try {
            await fetch(`${import.meta.env.VITE_API_URL}/api/files/${subData.backendFilename}`, { method: 'DELETE' });
          } catch (backendErr) {
            console.warn(`Backend file delete warning: ${backendErr.message}`);
          }
        }
        await deleteDoc(subDoc.ref);
      }

      // Delete chat messages
      const chatQuery = query(collection(db, 'chats'), where('assignmentId', '==', assignmentId));
      const chatSnap = await getDocs(chatQuery);
      for (const chatDoc of chatSnap.docs) {
        await deleteDoc(chatDoc.ref);
      }

      // Delete the assignment document
      await deleteDoc(doc(db, 'assignments', assignmentId));

      if (selectedAssignment?.assignmentId === assignmentId) {
        setSelectedAssignment(null);
      }

      await fetchData();
    } catch (err) {
      console.error("Assignment deletion failed:", err);
      setErrorMessage(`Failed to delete assignment: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ZIP Download
  const handleDownloadAll = async (assignment) => {
    const assignSubs = submissions.filter(s => s.assignmentId === assignment.assignmentId);
    if (assignSubs.length === 0) {
      alert("No student submissions recorded for this assignment.");
      return;
    }

    setZipLoading(true);
    try {
      const zip = new JSZip();
      
      const promises = assignSubs.map(async (sub) => {
        try {
          const response = await fetch(sub.fileUrl);
          if (!response.ok) throw new Error("Network issue fetching URL");
          const blob = await response.blob();
          const cleanName = sub.fileName || 'file';
          zip.file(`${sub.studentName}_${cleanName}`, blob);
        } catch (fetchErr) {
          console.error(`CORS or connection failure for ${sub.studentName}:`, fetchErr);
          zip.file(`${sub.studentName}_FETCH_FAILED_READ_LINK.txt`, `Direct Link: ${sub.fileUrl}`);
        }
      });

      await Promise.all(promises);
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      const downloadUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${assignment.name.replace(/\s+/g, '_')}_submissions.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("ZIP building failed:", err);
      alert("Could not compile zip archive.");
    } finally {
      setZipLoading(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="empty-state">
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}><Users size={28} /></div>
        <p>Analyzing system architecture and populating directories...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Admin Command Center</h1>
        <p className="dashboard-subtitle">Full system oversight — manage users, groups, and assignments across all tenants.</p>
      </div>

      {errorMessage && (
        <div className="badge badge-danger" style={{ display: 'flex', gap: '8px', padding: '12px 16px', marginBottom: '24px', borderRadius: 'var(--radius-sm)', alignItems: 'center' }}>
          <span style={{ flexGrow: 1 }}>{errorMessage}</span>
          <button 
            onClick={() => setErrorMessage('')}
            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '18px' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid-stats">
        <div className="glass stat-card">
          <div className="stat-icon"><Users size={24} /></div>
          <div>
            <div className="stat-value">{stats.users}</div>
            <div className="stat-label">Registered UIDs</div>
          </div>
        </div>
        <div className="glass stat-card">
          <div className="stat-icon"><BookOpen size={24} style={{ color: 'var(--secondary)' }} /></div>
          <div>
            <div className="stat-value">{stats.groups}</div>
            <div className="stat-label">Classroom Groups</div>
          </div>
        </div>
        <div className="glass stat-card">
          <div className="stat-icon"><Calendar size={24} style={{ color: 'var(--primary)' }} /></div>
          <div>
            <div className="stat-value">{stats.assignments}</div>
            <div className="stat-label">Assignments</div>
          </div>
        </div>
        <div className="glass stat-card">
          <div className="stat-icon"><FileCheck size={24} style={{ color: 'var(--success)' }} /></div>
          <div>
            <div className="stat-value">{stats.submissions}</div>
            <div className="stat-label">Total Submissions</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          User Management
        </button>
        <button 
          className={`tab-btn ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          Group Management
        </button>
        <button 
          className={`tab-btn ${activeTab === 'assignments' ? 'active' : ''}`}
          onClick={() => setActiveTab('assignments')}
        >
          Assignment Management
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: User Management                                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeTab === 'users' && (
        <div className="glass section-card">
          <h2 className="section-title">
            <Users size={20} />
            <span>System User Directory</span>
          </h2>

          <div className="table-wrapper">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Email Address</th>
                  <th>System Role</th>
                  <th>Role Assignment</th>
                  <th>Wipe Lifecycle</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.uid}>
                    <td>
                      <div className="flex-gap-10">
                        <img 
                          src={u.photoURL || 'https://via.placeholder.com/40'} 
                          alt="" 
                          style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                          onError={(e) => { e.target.src = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + u.uid; }}
                        />
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{u.email}</td>
                    <td>
                      <span className={`badge ${
                        u.role === 'admin' ? 'badge-danger' : u.role === 'teacher' ? 'badge-success' : 'badge-info'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td>
                      <select
                        className="form-select"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        value={u.role}
                        onChange={(e) => handleUpdateRole(u.uid, e.target.value)}
                        disabled={actionLoading || u.uid === currentUser?.uid}
                      >
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => handlePurgeUser(u)}
                        disabled={actionLoading || u.uid === currentUser?.uid}
                        title="Permanently wipe profile and related cloud resources"
                      >
                        <Trash2 size={14} />
                        <span>Purge</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: Group Management                                      */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeTab === 'groups' && (
        <div className="grid-columns-2">
          {/* Group Listing */}
          <div className="glass section-card">
            <h2 className="section-title">
              <BookOpen size={20} />
              <span>All Classroom Groups ({groups.length})</span>
            </h2>

            {groups.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px 0', textAlign: 'center' }}>
                No groups exist in the system yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {groups.map(g => {
                  const owner = usersMap[g.ownerId];
                  return (
                    <div 
                      key={g.groupId}
                      className={`glass glass-interactive ${selectedGroup?.groupId === g.groupId ? 'active' : ''}`}
                      style={{ 
                        padding: '16px', 
                        cursor: 'pointer',
                        borderColor: selectedGroup?.groupId === g.groupId ? 'var(--primary)' : 'var(--border-color)'
                      }}
                      onClick={() => setSelectedGroup(g)}
                    >
                      {/* Group Name */}
                      <div className="flex-between" style={{ marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '16px' }}>{g.name}</span>
                        <div className="flex-gap-10" onClick={e => e.stopPropagation()}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '8px 12px' }}
                            onClick={() => openEditGroup(g)}
                            title="Edit group details"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            className="btn btn-danger"
                            style={{ padding: '8px 12px' }}
                            onClick={() => handleDeleteGroup(g)}
                            disabled={actionLoading}
                            title="Delete group and all contents"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 8px' }}>
                        {g.description || 'No description'}
                      </p>

                      <div className="flex-between" style={{ fontSize: '12px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          Owner: <strong>{owner?.name || 'Unknown'}</strong>
                        </span>
                        <div className="flex-gap-10">
                          <span className={`badge ${g.isPublic ? 'badge-success' : 'badge-pending'}`}>
                            {g.isPublic ? 'Public' : 'Private'}
                          </span>
                          <span className="badge badge-info">{(g.members || []).length} members</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Group Detail Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {selectedGroup ? (
              <div className="glass section-card animate-fade-in">
                <h3 className="section-title" style={{ fontSize: '17px' }}>
                  <Eye size={18} />
                  <span>Group Details: {selectedGroup.name}</span>
                </h3>

                {/* Group Metadata */}
                <div style={{ fontSize: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                  <div>
                    <strong>Passcode:</strong> <code>{selectedGroup.passcode}</code>
                  </div>
                  <div>
                    <strong>Access:</strong> {selectedGroup.isPublic ? 'Public' : 'Private (Approval Required)'}
                  </div>
                  <div>
                    <strong>Owner:</strong> {usersMap[selectedGroup.ownerId]?.name || selectedGroup.ownerId}
                  </div>
                  <div>
                    <strong>Members:</strong> {(selectedGroup.members || []).length}
                  </div>
                </div>

                {/* Enrolled Members */}
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Enrolled Students
                </h4>
                {(!selectedGroup.members || selectedGroup.members.length === 0) ? (
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>No students enrolled.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                    {selectedGroup.members.map(uid => {
                      const profile = usersMap[uid] || { name: 'Resolving UID...', email: uid };
                      return (
                        <div key={uid} className="glass" style={{ padding: '8px 14px', fontSize: '13px' }}>
                          <div style={{ fontWeight: 600 }}>{profile.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profile.email}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pending Approvals */}
                {selectedGroup.pendingApprovals && selectedGroup.pendingApprovals.length > 0 && (
                  <div style={{ marginTop: '8px' }}>
                    <h4 style={{ fontSize: '13px', color: 'var(--warning)', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Pending Approvals ({selectedGroup.pendingApprovals.length})
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedGroup.pendingApprovals.map(uid => {
                        const profile = usersMap[uid] || { name: uid };
                        return (
                          <span key={uid} className="badge badge-pending" style={{ textTransform: 'none', padding: '6px 10px' }}>
                            {profile.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Assignments in this group */}
                <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                  <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Assignments in This Group
                  </h4>
                  {(() => {
                    const groupAssignments = assignments.filter(a => a.groupId === selectedGroup.groupId);
                    if (groupAssignments.length === 0) {
                      return <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No assignments created.</div>;
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {groupAssignments.map(a => {
                          const subCount = submissions.filter(s => s.assignmentId === a.assignmentId).length;
                          return (
                            <div 
                              key={a.assignmentId} 
                              className="glass glass-interactive" 
                              style={{ padding: '12px 14px', cursor: 'pointer' }}
                              onClick={() => { setActiveTab('assignments'); setSelectedAssignment(a); }}
                            >
                              <div className="flex-between">
                                <span style={{ fontWeight: 600, fontSize: '14px' }}>{a.name}</span>
                                <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                              </div>
                              <div className="flex-between" style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                <span>Due: {formatDate(a.dueDate)}</span>
                                <span className="badge badge-info">{subCount} submissions</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="glass section-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Eye size={32} style={{ opacity: 0.4, marginBottom: '12px' }} />
                  <p style={{ fontSize: '14px' }}>Select a group to view its details, members, and assignments.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: Assignment Management                                 */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeTab === 'assignments' && (
        <div className="grid-columns-2">
          {/* Assignment Listing */}
          <div className="glass section-card">
            <h2 className="section-title">
              <Calendar size={20} />
              <span>All Assignments ({assignments.length})</span>
            </h2>

            {assignments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '16px 0', textAlign: 'center' }}>
                No assignments exist in the system yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {assignments.map(a => {
                  const group = groups.find(g => g.groupId === a.groupId);
                  const subCount = submissions.filter(s => s.assignmentId === a.assignmentId).length;
                  return (
                    <div 
                      key={a.assignmentId}
                      className={`glass glass-interactive ${selectedAssignment?.assignmentId === a.assignmentId ? 'active' : ''}`}
                      style={{ 
                        padding: '16px', 
                        cursor: 'pointer',
                        borderColor: selectedAssignment?.assignmentId === a.assignmentId ? 'var(--primary)' : 'var(--border-color)'
                      }}
                      onClick={() => setSelectedAssignment(a)}
                    >
                      <div className="flex-between" style={{ marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700 }}>{a.name}</span>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={(e) => { e.stopPropagation(); handleDeleteAssignment(a); }}
                          disabled={actionLoading}
                          title="Delete assignment and all contents"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        Group: {group?.name || 'Unknown'} • Owner: {usersMap[group?.ownerId]?.name || 'Unknown'}
                      </div>
                      <div className="flex-between" style={{ fontSize: '12px' }}>
                        <span>Due: {formatDate(a.dueDate)}</span>
                        <span className="badge badge-info">{subCount} submissions</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Assignment Detail & Submissions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {selectedAssignment ? (
              <div className="glass section-card animate-fade-in">
                <div className="flex-between" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '17px', margin: 0 }}>
                    {selectedAssignment.name}
                  </h3>
                  <div className="flex-gap-10">
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleDownloadAll(selectedAssignment)}
                      disabled={zipLoading}
                      title="Compile and download all files as a single .zip"
                    >
                      <FileArchive size={14} />
                      <span>{zipLoading ? 'Compiling...' : 'Download All'}</span>
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteAssignment(selectedAssignment)}
                      disabled={actionLoading}
                    >
                      <Trash2 size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* Assignment Metadata */}
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: '1.6' }}>
                  {selectedAssignment.description || 'No description provided.'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', marginBottom: '20px' }}>
                  <div><strong>Start:</strong> {formatDate(selectedAssignment.startDate)}</div>
                  <div><strong>Due:</strong> {formatDate(selectedAssignment.dueDate)}</div>
                  <div><strong>Group:</strong> {groups.find(g => g.groupId === selectedAssignment.groupId)?.name || 'Unknown'}</div>
                  <div><strong>Peer Sharing:</strong> {selectedAssignment.shareVisibility ? 'Enabled' : 'Disabled'}</div>
                </div>

                {/* Submissions Table */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                  <h4 style={{ fontSize: '14px', marginBottom: '12px' }}>
                    Submissions ({submissions.filter(s => s.assignmentId === selectedAssignment.assignmentId).length})
                  </h4>
                  
                  {submissions.filter(s => s.assignmentId === selectedAssignment.assignmentId).length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0', textAlign: 'center' }}>
                      No student submissions uploaded yet.
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="custom-table" style={{ fontSize: '13px' }}>
                        <thead>
                          <tr>
                            <th>Student</th>
                            <th>File</th>
                            <th>Timestamp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {submissions
                            .filter(s => s.assignmentId === selectedAssignment.assignmentId)
                            .map(sub => (
                              <tr key={sub.submissionId}>
                                <td style={{ fontWeight: 600 }}>{sub.studentName}</td>
                                <td>
                                  <a 
                                    href={sub.fileUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                    className="parsed-link"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                  >
                                    {sub.fileName || 'View file'}
                                  </a>
                                </td>
                                <td style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{formatDate(sub.submittedAt)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="glass section-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <Calendar size={32} style={{ opacity: 0.4, marginBottom: '12px' }} />
                  <p style={{ fontSize: '14px' }}>Select an assignment to view its details and student submissions.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Group Modal */}
      {showEditGroup && (
        <div className="modal-overlay" onClick={() => setShowEditGroup(null)}>
          <div className="modal-content glass animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Edit Classroom Details</h2>
              <button className="btn btn-secondary" style={{ padding: '4px' }} onClick={() => setShowEditGroup(null)}><X size={16} /></button>
            </div>
            <form onSubmit={handleUpdateGroup}>
              <div className="form-group">
                <label className="form-label">Classroom Name</label>
                <input type="text" className="form-input" value={groupForm.name} onChange={e => setGroupForm({...groupForm, name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={groupForm.description} onChange={e => setGroupForm({...groupForm, description: e.target.value})} rows="3" />
              </div>
              <div className="form-group">
                <label className="form-label">Entry Passcode</label>
                <input type="text" className="form-input" value={groupForm.passcode} onChange={e => setGroupForm({...groupForm, passcode: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Access Model</label>
                <select className="form-select" value={groupForm.isPublic ? 'public' : 'private'} onChange={e => setGroupForm({...groupForm, isPublic: e.target.value === 'public'})}>
                  <option value="public">Public (Instant joining with passcode)</option>
                  <option value="private">Private (Approval ledger validation required)</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={actionLoading}>
                Save Changes
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
