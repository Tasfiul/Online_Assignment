import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc,
  deleteDoc, 
  query, 
  where,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

import { 
  Plus, 
  Users, 
  Calendar, 
  FileArchive, 
  MessageSquare, 
  UserCheck, 
  UserX, 
  AlertOctagon,
  Copy,
  Check,
  ChevronLeft,
  Settings,
  Trash2,
  Edit3,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/helpers';
import JSZip from 'jszip';

export default function TeacherDashboard({ onOpenChat }) {
  const { currentUser } = useAuth();
  
  // Data State
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [allUsers, setAllUsers] = useState({});
  
  // Navigation & Selection States
  const [activeGroupDetail, setActiveGroupDetail] = useState(null);
  
  // UI States
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [copiedGroupCode, setCopiedGroupCode] = useState(null);

  // Modal States
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(null);
  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [showEditAssignment, setShowEditAssignment] = useState(null);
  const [showRoster, setShowRoster] = useState(false);

  // Form Fields - Group
  const [groupForm, setGroupForm] = useState({ name: '', description: '', passcode: '', isPublic: true });

  // Form Fields - Assignment
  const [assignForm, setAssignForm] = useState({
    name: '',
    description: '',
    startDate: '',
    dueDate: '',
    shareVisibility: false,
    allowedTypes: { pdf: true, image: true, video: false, link: false, codeOrDoc: true }
  });

  const loadTeacherData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersMap = {};
      usersSnap.forEach(d => { usersMap[d.id] = d.data(); });
      setAllUsers(usersMap);

      const groupQuery = query(collection(db, 'groups'), where('ownerId', '==', currentUser.uid));
      const groupSnap = await getDocs(groupQuery);
      const groupsList = [];
      groupSnap.forEach(d => { groupsList.push({ groupId: d.id, ...d.data() }); });
      setGroups(groupsList);

      const assignmentsList = [];
      if (groupsList.length > 0) {
        const groupIds = groupsList.map(g => g.groupId);
        const assignSnap = await getDocs(collection(db, 'assignments'));
        assignSnap.forEach(d => {
          const assignData = d.data();
          if (groupIds.includes(assignData.groupId)) {
            assignmentsList.push({ assignmentId: d.id, ...assignData });
          }
        });
      }
      setAssignments(assignmentsList);

      const subSnap = await getDocs(collection(db, 'submissions'));
      const submissionsList = [];
      subSnap.forEach(d => { submissionsList.push({ submissionId: d.id, ...d.data() }); });
      setSubmissions(submissionsList);

    } catch (error) {
      console.error("Error loading teacher assets:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadTeacherData();
  }, [loadTeacherData]);

  // ─── Group CRUD ───────────────────────────────────────────────

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupForm.name || !groupForm.passcode) return;
    setActionLoading(true);
    try {
      const newGroup = {
        ...groupForm,
        ownerId: currentUser.uid,
        members: [],
        pendingApprovals: [],
        bannedUsers: [],
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, 'groups'), newGroup);
      setShowCreateGroup(false);
      setGroupForm({ name: '', description: '', passcode: '', isPublic: true });
      await loadTeacherData();
    } catch (err) {
      alert("Failed to create group.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateGroup = async (e) => {
    e.preventDefault();
    if (!groupForm.name || !groupForm.passcode) return;
    setActionLoading(true);
    try {
      const groupRef = doc(db, 'groups', showEditGroup.groupId);
      await updateDoc(groupRef, {
        name: groupForm.name,
        description: groupForm.description,
        passcode: groupForm.passcode,
        isPublic: groupForm.isPublic
      });
      setShowEditGroup(null);
      await loadTeacherData();
      if (activeGroupDetail) setActiveGroupDetail(prev => ({ ...prev, ...groupForm }));
    } catch (err) {
      alert("Failed to update group.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm("WARNING: This will permanently delete this group, all its assignments, submissions, and files. Continue?")) return;
    setActionLoading(true);
    try {
      // 1. Find all assignments in this group
      const assignQuery = query(collection(db, 'assignments'), where('groupId', '==', groupId));
      const assignSnap = await getDocs(assignQuery);

      for (const assignDoc of assignSnap.docs) {
        const assignmentId = assignDoc.id;
        
        // Delete submissions and backend files
        const subQuery = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId));
        const subSnap = await getDocs(subQuery);
        for (const subDoc of subSnap.docs) {
          const subData = subDoc.data();
          if (subData.backendFilename) {
            try { await fetch(`http://localhost:5000/api/files/${subData.backendFilename}`, { method: 'DELETE' }); } catch (e) { }
          }
          await deleteDoc(subDoc.ref);
        }

        // Delete chat messages
        const chatQuery = query(collection(db, 'chats'), where('assignmentId', '==', assignmentId));
        const chatSnap = await getDocs(chatQuery);
        for (const chatDoc of chatSnap.docs) { await deleteDoc(chatDoc.ref); }

        await deleteDoc(assignDoc.ref);
      }

      await deleteDoc(doc(db, 'groups', groupId));
      setActiveGroupDetail(null);
      await loadTeacherData();
    } catch (err) {
      alert("Failed to delete group.");
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Assignment CRUD ─────────────────────────────────────────

  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    if (!assignForm.name || !assignForm.startDate || !assignForm.dueDate || !activeGroupDetail) return;
    setActionLoading(true);
    try {
      const newAssignment = {
        groupId: activeGroupDetail.groupId,
        ...assignForm,
        startDate: Timestamp.fromDate(new Date(assignForm.startDate)),
        dueDate: Timestamp.fromDate(new Date(assignForm.dueDate)),
        createdAt: serverTimestamp()
      };
      await addDoc(collection(db, 'assignments'), newAssignment);
      setShowCreateAssignment(false);
      await loadTeacherData();
    } catch (err) {
      alert("Failed to deploy assignment.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateAssignment = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const assignRef = doc(db, 'assignments', showEditAssignment.assignmentId);
      await updateDoc(assignRef, {
        name: assignForm.name,
        description: assignForm.description,
        shareVisibility: assignForm.shareVisibility,
        allowedTypes: assignForm.allowedTypes,
        startDate: Timestamp.fromDate(new Date(assignForm.startDate)),
        dueDate: Timestamp.fromDate(new Date(assignForm.dueDate)),
      });
      setShowEditAssignment(null);
      await loadTeacherData();
    } catch (err) {
      alert("Failed to update assignment.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId) => {
    if (!window.confirm("WARNING: This will permanently delete this assignment, all student submissions, and chat history. Continue?")) return;
    setActionLoading(true);
    try {
      const subQuery = query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId));
      const subSnap = await getDocs(subQuery);
      for (const subDoc of subSnap.docs) {
        const subData = subDoc.data();
        if (subData.backendFilename) {
          try { await fetch(`http://localhost:5000/api/files/${subData.backendFilename}`, { method: 'DELETE' }); } catch (e) { }
        }
        await deleteDoc(subDoc.ref);
      }

      const chatQuery = query(collection(db, 'chats'), where('assignmentId', '==', assignmentId));
      const chatSnap = await getDocs(chatQuery);
      for (const chatDoc of chatSnap.docs) { await deleteDoc(chatDoc.ref); }

      await deleteDoc(doc(db, 'assignments', assignmentId));
      await loadTeacherData();
    } catch (err) {
      alert("Failed to delete assignment.");
    } finally {
      setActionLoading(false);
    }
  };

  const openEditGroup = (g) => {
    setGroupForm({
      name: g.name, description: g.description || '', passcode: g.passcode, isPublic: g.isPublic
    });
    setShowEditGroup(g);
  };

  const openEditAssignment = (a) => {
    setAssignForm({
      name: a.name,
      description: a.description || '',
      shareVisibility: a.shareVisibility || false,
      allowedTypes: a.allowedTypes || { pdf: true, image: true, video: false, link: false, codeOrDoc: true },
      startDate: a.startDate.toDate().toISOString().slice(0, 16),
      dueDate: a.dueDate.toDate().toISOString().slice(0, 16),
    });
    setShowEditAssignment(a);
  };

  // ─── Roster Governance ────────────────────────────────────────

  const handleUpdateRoster = async (groupId, action, studentId) => {
    const groupRef = doc(db, 'groups', groupId);
    const group = groups.find(g => g.groupId === groupId);
    if (!group) return;

    let { members = [], pendingApprovals = [], bannedUsers = [] } = group;

    if (action === 'approve') {
      pendingApprovals = pendingApprovals.filter(id => id !== studentId);
      if (!members.includes(studentId)) members.push(studentId);
    } else if (action === 'kick') {
      members = members.filter(id => id !== studentId);
    } else if (action === 'ban') {
      members = members.filter(id => id !== studentId);
      pendingApprovals = pendingApprovals.filter(id => id !== studentId);
      if (!bannedUsers.includes(studentId)) bannedUsers.push(studentId);
    }

    try {
      await updateDoc(groupRef, { members, pendingApprovals, bannedUsers });
      await loadTeacherData();
      if (activeGroupDetail?.groupId === groupId) {
        setActiveGroupDetail(prev => ({ ...prev, members, pendingApprovals, bannedUsers }));
      }
    } catch (err) {
      alert("Roster update failed.");
    }
  };

  // ─── Utilities ────────────────────────────────────────────────

  const handleDownloadStudent = async (studentGroup, assignment) => {
    setZipLoading(true);
    try {
      const zip = new JSZip();
      const promises = studentGroup.files.map(async (sub) => {
        try {
          const response = await fetch(sub.fileUrl);
          if (!response.ok) throw new Error("Network issue");
          const blob = await response.blob();
          zip.file(`${sub.fileName || 'file'}`, blob);
        } catch (fetchErr) {
          zip.file(`FETCH_FAILED_${sub.fileName || 'file'}.txt`, `Link: ${sub.fileUrl}`);
        }
      });
      await Promise.all(promises);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const downloadUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${studentGroup.studentName.replace(/\s+/g, '_')}_${assignment.name.replace(/\s+/g, '_')}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      alert("Could not compile zip archive.");
    } finally {
      setZipLoading(false);
    }
  };

  const copyToClipboard = (text, groupId) => {
    navigator.clipboard.writeText(text);
    setCopiedGroupCode(groupId);
    setTimeout(() => setCopiedGroupCode(null), 2000);
  };

  // ─── Render Components ────────────────────────────────────────

  if (loading) {
    return (
      <div className="empty-state">
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}><Users size={28} /></div>
        <p>Loading teacher configuration and mapping student rosters...</p>
      </div>
    );
  }

  const groupAssignments = activeGroupDetail ? assignments.filter(a => a.groupId === activeGroupDetail.groupId) : [];

  return (
    <>
      {activeGroupDetail ? (
        <div className="animate-fade-in">
        <button 
          className="btn btn-secondary" 
          style={{ marginBottom: '20px' }} 
          onClick={() => setActiveGroupDetail(null)}
        >
          <ChevronLeft size={16} /> Back to Classrooms
        </button>

        {/* Group Header */}
        <div className="glass section-card" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={() => setShowRoster(true)} title="Manage Roster" style={{ position: 'relative' }}>
              <Users size={14} /> Roster
              {activeGroupDetail.pendingApprovals?.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  width: '10px',
                  height: '10px',
                  backgroundColor: 'var(--danger)',
                  borderRadius: '50%'
                }} />
              )}
            </button>
            <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => openEditGroup(activeGroupDetail)} title="Edit Classroom">
              <Settings size={16} />
            </button>
            <button className="btn btn-danger" style={{ padding: '8px 12px' }} onClick={() => handleDeleteGroup(activeGroupDetail.groupId)} title="Delete Classroom">
              <Trash2 size={16} />
            </button>
          </div>
          <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>{activeGroupDetail.name}</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '16px', maxWidth: '80%' }}>{activeGroupDetail.description}</p>
          <div className="flex-gap-10" style={{ fontSize: '13px' }}>
            <span className={`badge ${activeGroupDetail.isPublic ? 'badge-success' : 'badge-pending'}`}>
              {activeGroupDetail.isPublic ? 'Public Access' : 'Private Access'}
            </span>
            <span className="flex-gap-10 glass" style={{ padding: '4px 10px', borderRadius: '16px' }}>
              <strong>Code:</strong> <code>{activeGroupDetail.passcode}</code>
              <button 
                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                onClick={() => copyToClipboard(activeGroupDetail.passcode, activeGroupDetail.groupId)}
              >
                {copiedGroupCode === activeGroupDetail.groupId ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
            </span>
            <span className="glass" style={{ padding: '4px 10px', borderRadius: '16px' }}>
              <Users size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/>
              {(activeGroupDetail.members || []).length} Students
            </span>
          </div>
        </div>

        {/* Group Layout Grid */}
        <div style={{ marginTop: '24px' }}>
          
          {/* Column 1: Assignments */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="flex-between">
              <h2 style={{ fontSize: '18px' }} className="flex-gap-10"><Calendar size={20} className="text-primary" /> Assignments</h2>
              <button className="btn btn-primary" onClick={() => {
                setAssignForm({ name: '', description: '', startDate: '', dueDate: '', shareVisibility: false, allowedTypes: { pdf: true, image: true, video: false, link: false, codeOrDoc: true } });
                setShowCreateAssignment(true);
              }}>
                <Plus size={16} /> New Assignment
              </button>
            </div>

            {groupAssignments.length === 0 ? (
              <div className="empty-state glass">No assignments deployed for this class yet.</div>
            ) : (
              groupAssignments.map(a => {
                const assignSubs = submissions.filter(s => s.assignmentId === a.assignmentId);
                
                // Group by student
                const studentGroupsMap = {};
                assignSubs.forEach(sub => {
                  if (!studentGroupsMap[sub.studentId]) {
                    studentGroupsMap[sub.studentId] = {
                      studentId: sub.studentId,
                      studentName: sub.studentName,
                      files: []
                    };
                  }
                  studentGroupsMap[sub.studentId].files.push(sub);
                });
                const uniqueStudents = Object.values(studentGroupsMap);

                return (
                  <div key={a.assignmentId} className="glass section-card" style={{ padding: '16px' }}>
                    <div className="flex-between" style={{ marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '16px', margin: 0 }}>{a.name}</h3>
                      <div className="flex-gap-10">
                        <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => openEditAssignment(a)}><Edit3 size={16} /></button>
                        <button className="btn btn-danger" style={{ padding: '8px 12px' }} onClick={() => handleDeleteAssignment(a.assignmentId)}><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="flex-between" style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                      <span>Due: {formatDate(a.dueDate)}</span>
                      <span className="badge badge-info">{uniqueStudents.length} Student{uniqueStudents.length !== 1 && 's'} Submitted</span>
                    </div>

                    {/* Submissions Mini-Table */}
                    <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                      <div className="flex-between" style={{ marginBottom: '12px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>Student Work</span>
                        <div className="flex-gap-10">
                          <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }} onClick={() => onOpenChat(a)}>
                            <MessageSquare size={12} /> Forum
                          </button>
                        </div>
                      </div>
                      
                      {uniqueStudents.length === 0 ? (
                         <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No submissions yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {uniqueStudents.map(studentGroup => (
                            <div key={studentGroup.studentId} style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <div className="flex-between" style={{ marginBottom: '8px' }}>
                                <span style={{ fontWeight: 600, fontSize: '13px' }}>{studentGroup.studentName}</span>
                                <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px' }} disabled={zipLoading} onClick={() => handleDownloadStudent(studentGroup, a)}>
                                  <FileArchive size={12} /> Download ZIP
                                </button>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {studentGroup.files.map(file => (
                                  <a key={file.submissionId} href={file.fileUrl} target="_blank" rel="noopener noreferrer" className="parsed-link badge badge-secondary" style={{ fontSize: '11px', textTransform: 'none' }}>
                                    {file.fileName || 'View file'}
                                  </a>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        </div>
      ) : (
        <div className="animate-fade-in">
          <div className="dashboard-header flex-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="dashboard-title">Teacher Command Center</h1>
          <p className="dashboard-subtitle">Select a classroom to manage rosters, deploy assignments, and grade submissions.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateGroup(true)}>
          <Plus size={18} /> Instantiate Classroom
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '24px' }}>
        {groups.length === 0 ? (
          <div className="empty-state glass" style={{ gridColumn: '1 / -1' }}>
            No classrooms registered yet. Click "Instantiate Classroom" to start teaching.
          </div>
        ) : (
          groups.map(g => (
            <div 
              key={g.groupId} 
              className="glass glass-interactive section-card"
              style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              onClick={() => setActiveGroupDetail(g)}
            >
              <div className="flex-between" style={{ marginBottom: '12px' }}>
                <span className={`badge ${g.isPublic ? 'badge-success' : 'badge-pending'}`}>
                  {g.isPublic ? 'Public' : 'Private'}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Users size={14} /> {(g.members || []).length}
                </span>
              </div>
              <h3 style={{ fontSize: '18px', margin: '0 0 8px 0' }}>{g.name}</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 16px 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {g.description || 'No description provided.'}
              </p>
              
              <div className="flex-between" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', fontSize: '12px' }}>
                <span className="flex-gap-10">
                  <strong>Code:</strong> <code>{g.passcode}</code>
                </span>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '4px 8px', height: 'auto' }}
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(g.passcode, g.groupId); }}
                >
                  {copiedGroupCode === g.groupId ? <Check size={12} className="text-success" /> : <Copy size={12} />} Copy
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )}

      {/* ─── MODALS ─── */}
      
      {/* Create / Edit Group Modal */}
      {(showCreateGroup || showEditGroup) && (
        <div className="modal-overlay" onClick={() => { setShowCreateGroup(false); setShowEditGroup(null); }}>
          <div className="modal-content glass animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{showEditGroup ? 'Edit Classroom' : 'Instantiate Classroom'}</h2>
              <button className="btn btn-secondary" style={{ padding: '4px' }} onClick={() => { setShowCreateGroup(false); setShowEditGroup(null); }}><X size={16} /></button>
            </div>
            <form onSubmit={showEditGroup ? handleUpdateGroup : handleCreateGroup}>
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
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={actionLoading}>
                {showEditGroup ? 'Save Changes' : 'Create Group'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Assignment Modal */}
      {(showCreateAssignment || showEditAssignment) && (
        <div className="modal-overlay" onClick={() => { setShowCreateAssignment(false); setShowEditAssignment(null); }}>
          <div className="modal-content glass animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{showEditAssignment ? 'Edit Assignment' : 'Deploy Assignment'}</h2>
              <button className="btn btn-secondary" style={{ padding: '4px' }} onClick={() => { setShowCreateAssignment(false); setShowEditAssignment(null); }}><X size={16} /></button>
            </div>
            <form onSubmit={showEditAssignment ? handleUpdateAssignment : handleCreateAssignment}>
              <div className="form-group">
                <label className="form-label">Assignment Name</label>
                <input type="text" className="form-input" value={assignForm.name} onChange={e => setAssignForm({...assignForm, name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Instructions / Description</label>
                <textarea className="form-textarea" value={assignForm.description} onChange={e => setAssignForm({...assignForm, description: e.target.value})} rows="4" required />
              </div>
              <div className="form-group">
                <label className="form-label">Allowed File Types</label>
                <div className="form-checkbox-group">
                  <label className="checkbox-label"><input type="checkbox" checked={assignForm.allowedTypes.pdf} onChange={e => setAssignForm({...assignForm, allowedTypes: {...assignForm.allowedTypes, pdf: e.target.checked}})} /> PDF</label>
                  <label className="checkbox-label"><input type="checkbox" checked={assignForm.allowedTypes.image} onChange={e => setAssignForm({...assignForm, allowedTypes: {...assignForm.allowedTypes, image: e.target.checked}})} /> Image</label>
                  <label className="checkbox-label"><input type="checkbox" checked={assignForm.allowedTypes.video} onChange={e => setAssignForm({...assignForm, allowedTypes: {...assignForm.allowedTypes, video: e.target.checked}})} /> Video</label>
                  <label className="checkbox-label"><input type="checkbox" checked={assignForm.allowedTypes.codeOrDoc} onChange={e => setAssignForm({...assignForm, allowedTypes: {...assignForm.allowedTypes, codeOrDoc: e.target.checked}})} /> Code/Doc</label>
                </div>
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input type="checkbox" checked={assignForm.shareVisibility} onChange={e => setAssignForm({...assignForm, shareVisibility: e.target.checked})} />
                  <strong>Peer Sharing</strong> (Let students view classmates' submissions)
                </label>
              </div>
              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label className="form-label">Start Date</label>
                  <input type="datetime-local" className="form-input" value={assignForm.startDate} onChange={e => setAssignForm({...assignForm, startDate: e.target.value})} required />
                </div>
                <div>
                  <label className="form-label">Due Date</label>
                  <input type="datetime-local" className="form-input" value={assignForm.dueDate} onChange={e => setAssignForm({...assignForm, dueDate: e.target.value})} required />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px' }} disabled={actionLoading}>
                {showEditAssignment ? 'Save Changes' : 'Deploy Assignment'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Roster Modal */}
      {showRoster && activeGroupDetail && (
        <div className="modal-overlay" onClick={() => setShowRoster(false)}>
          <div className="modal-content glass animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }} className="flex-gap-10"><Users size={20} className="text-primary" /> Class Roster</h2>
              <button className="btn btn-secondary" style={{ padding: '4px' }} onClick={() => setShowRoster(false)}><X size={16} /></button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Pending Approvals */}
              {activeGroupDetail.pendingApprovals?.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '12px', color: 'var(--warning)', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Pending Requests ({activeGroupDetail.pendingApprovals.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activeGroupDetail.pendingApprovals.map(uid => {
                      const profile = allUsers[uid] || { name: 'Loading...', email: uid };
                      return (
                        <div key={uid} className="flex-between glass" style={{ padding: '8px 12px', background: 'rgba(245, 158, 11, 0.05)' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '13px' }}>{profile.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profile.email}</div>
                          </div>
                          <div className="flex-gap-10">
                            <button className="btn btn-primary" style={{ padding: '4px' }} onClick={() => handleUpdateRoster(activeGroupDetail.groupId, 'approve', uid)}><UserCheck size={14} /></button>
                            <button className="btn btn-danger" style={{ padding: '4px' }} onClick={() => handleUpdateRoster(activeGroupDetail.groupId, 'ban', uid)}><AlertOctagon size={14} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active Members */}
              <div>
                 <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Enrolled Students ({activeGroupDetail.members?.length || 0})
                  </h4>
                  {(!activeGroupDetail.members || activeGroupDetail.members.length === 0) ? (
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No students enrolled.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {activeGroupDetail.members.map(uid => {
                        const profile = allUsers[uid] || { name: 'Loading...', email: uid };
                        return (
                          <div key={uid} className="flex-between glass" style={{ padding: '8px 12px' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '13px' }}>{profile.name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profile.email}</div>
                            </div>
                            <div className="flex-gap-10">
                              <button className="btn btn-secondary" style={{ padding: '4px' }} title="Kick Student" onClick={() => handleUpdateRoster(activeGroupDetail.groupId, 'kick', uid)}><UserX size={14} /></button>
                              <button className="btn btn-danger" style={{ padding: '4px' }} title="Ban Student" onClick={() => handleUpdateRoster(activeGroupDetail.groupId, 'ban', uid)}><AlertOctagon size={14} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>

              {/* Banned Users */}
              {activeGroupDetail.bannedUsers?.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '12px', color: 'var(--danger)', textTransform: 'uppercase', marginBottom: '12px' }}>
                    Banned ({activeGroupDetail.bannedUsers.length})
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {activeGroupDetail.bannedUsers.map(uid => (
                      <span key={uid} className="badge badge-danger" style={{ textTransform: 'none' }}>
                        {(allUsers[uid] || {}).name || uid}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
    </>
  );
}
