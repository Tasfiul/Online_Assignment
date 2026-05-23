import { useCallback, useEffect, useState } from 'react';
import { db, storage } from '../firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { Users, BookOpen, FileCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AdminDashboard() {
  const { currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({ users: 0, groups: 0, assignments: 0, submissions: 0 });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersList = [];
      usersSnap.forEach(d => usersList.push(d.data()));
      setUsers(usersList);

      // 2. Fetch Groups
      const groupsSnap = await getDocs(collection(db, 'groups'));
      
      // 3. Fetch Assignments
      const assignmentsSnap = await getDocs(collection(db, 'assignments'));
      
      // 4. Fetch Submissions
      const submissionsSnap = await getDocs(collection(db, 'submissions'));

      setStats({
        users: usersSnap.size,
        groups: groupsSnap.size,
        assignments: assignmentsSnap.size,
        submissions: submissionsSnap.size
      });
    } catch (error) {
      console.error("Error loading admin stats:", error);
      setErrorMessage("Failed to load dashboard data. Check database permissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update a user's role
  const handleUpdateRole = async (targetUid, newRole) => {
    if (actionLoading) return;
    setActionLoading(true);
    setErrorMessage('');
    
    try {
      const userRef = doc(db, 'users', targetUid);
      await updateDoc(userRef, { role: newRole });
      
      // Update local state
      setUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error(err);
      setErrorMessage("Failed to update user role.");
    } finally {
      setActionLoading(false);
    }
  };

  // Perform client-side user deletion purge sequence
  const handlePurgeUser = async (targetUser) => {
    const confirmMessage = `WARNING: Are you absolutely sure you want to delete and PURGE "${targetUser.name}" (${targetUser.role})?\nThis will permanently delete all associated files, chat logs, submissions, and records. This action is irreversible.`;
    if (!window.confirm(confirmMessage)) return;

    setActionLoading(true);
    setErrorMessage('');
    const targetUid = targetUser.uid;

    try {
      if (targetUser.role === 'student') {
        // --- STUDENT PURGE SEQUENCE ---
        
        // 1. Search submissions matching studentId
        const subQuery = query(collection(db, 'submissions'), where('studentId', '==', targetUid));
        const subSnap = await getDocs(subQuery);
        
        for (const subDoc of subSnap.docs) {
          const subData = subDoc.data();
          
          // 2. Wipe 6MB binary file footprint from storage
          try {
            const filePath = `groups/${subData.groupId}/assignments/${subData.assignmentId}/${targetUid}_file`;
            const fileRef = ref(storage, filePath);
            await deleteObject(fileRef);
          } catch (storageErr) {
            // Storage file might not exist, proceed
            console.warn(`File delete warning: ${storageErr.message}`);
          }
          
          // 3. Delete submission document from Firestore
          await deleteDoc(subDoc.ref);
        }

        // 4. Remove student UID from all group members and pendingApprovals lists
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

        // 5. Delete the primary user document
        await deleteDoc(doc(db, 'users', targetUid));

      } else if (targetUser.role === 'teacher') {
        // --- TEACHER PURGE SEQUENCE ---
        
        // 1. Flag all group documents where ownerId == teacherUid
        const groupQuery = query(collection(db, 'groups'), where('ownerId', '==', targetUid));
        const groupSnap = await getDocs(groupQuery);

        for (const groupDoc of groupSnap.docs) {
          const groupId = groupDoc.id;

          // 2. Find all assignments in this group
          const assignQuery = query(collection(db, 'assignments'), where('groupId', '==', groupId));
          const assignSnap = await getDocs(assignQuery);

          for (const assignDoc of assignSnap.docs) {
            const assignmentId = assignDoc.id;

            // 3. Clear all student file submission assets in Storage & Firestore
            const subQuery = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId));
            const subSnap = await getDocs(subQuery);

            for (const subDoc of subSnap.docs) {
              const subData = subDoc.data();
              try {
                const filePath = `groups/${groupId}/assignments/${assignmentId}/${subData.studentId}_file`;
                const fileRef = ref(storage, filePath);
                await deleteObject(fileRef);
              } catch (storageErr) {
                console.warn(`File delete warning: ${storageErr.message}`);
              }
              await deleteDoc(subDoc.ref);
            }

            // 4. Delete chats history tied to assignment
            const chatQuery = query(collection(db, 'chats'), where('assignmentId', '==', assignmentId));
            const chatSnap = await getDocs(chatQuery);
            for (const chatDoc of chatSnap.docs) {
              await deleteDoc(chatDoc.ref);
            }

            // 5. Delete assignment document
            await deleteDoc(assignDoc.ref);
          }

          // 6. Delete group document
          await deleteDoc(groupDoc.ref);
        }

        // 7. Delete primary user profile
        await deleteDoc(doc(db, 'users', targetUid));
      } else {
        // Just delete admin user document
        await deleteDoc(doc(db, 'users', targetUid));
      }

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error("Purge failure:", err);
      setErrorMessage(`Failed to fully purge user: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}><Users size={28} /></div>
        <p>Analyzing system architecture and populating user directories...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Admin Command Center</h1>
        <p className="dashboard-subtitle">Monitor tenant statistics, manage system permission tiers, and execute user lifecycle purges.</p>
      </div>

      {errorMessage && (
        <div className="badge badge-danger" style={{ display: 'block', padding: '12px', marginBottom: '24px', borderRadius: 'var(--radius-sm)' }}>
          {errorMessage}
        </div>
      )}

      {/* Stats Summary cards */}
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
          <div className="stat-icon"><FileCheck size={24} style={{ color: 'var(--success)' }} /></div>
          <div>
            <div className="stat-value">{stats.submissions}</div>
            <div className="stat-label">Total Submissions</div>
          </div>
        </div>
      </div>

      {/* User Directory */}
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
    </div>
  );
}
