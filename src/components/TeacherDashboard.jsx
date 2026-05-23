import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc, 
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
  Check
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/helpers';
import JSZip from 'jszip';

export default function TeacherDashboard({ onOpenChat }) {
  const { currentUser } = useAuth();
  
  // Tabs
  const [activeTab, setActiveTab] = useState('groups'); // 'groups' or 'assignments'
  
  // Data State
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [allUsers, setAllUsers] = useState({}); // Mapping of uid -> user profile
  
  // Selection States
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  
  // Form Loading States
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [copiedGroupCode, setCopiedGroupCode] = useState(null);

  // Form Fields - New Group
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupPass, setGroupPass] = useState('');
  const [groupPublic, setGroupPublic] = useState(true);

  // Form Fields - New Assignment
  const [assignName, setAssignName] = useState('');
  const [assignDesc, setAssignDesc] = useState('');
  const [assignStart, setAssignStart] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [allowedTypes, setAllowedTypes] = useState({
    pdf: true,
    image: true,
    video: false,
    link: false,
    codeOrDoc: true
  });
  const [shareVisibility, setShareVisibility] = useState(false);

  const loadTeacherData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Fetch Users map for display names
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersMap = {};
      usersSnap.forEach(d => {
        usersMap[d.id] = d.data();
      });
      setAllUsers(usersMap);

      // 2. Fetch Groups owned by this teacher
      const groupQuery = query(collection(db, 'groups'), where('ownerId', '==', currentUser.uid));
      const groupSnap = await getDocs(groupQuery);
      const groupsList = [];
      groupSnap.forEach(d => {
        groupsList.push({ groupId: d.id, ...d.data() });
      });
      setGroups(groupsList);

      // 3. Fetch Assignments for these groups
      const assignmentsList = [];
      if (groupsList.length > 0) {
        const groupIds = groupsList.map(g => g.groupId);
        // Firestore limit: where in query supports up to 10 elements. 
        // We will fetch all and filter in memory if needed, or query chunks.
        const assignSnap = await getDocs(collection(db, 'assignments'));
        assignSnap.forEach(d => {
          const assignData = d.data();
          if (groupIds.includes(assignData.groupId)) {
            assignmentsList.push({ assignmentId: d.id, ...assignData });
          }
        });
      }
      setAssignments(assignmentsList);

      // 4. Fetch Submissions
      const subSnap = await getDocs(collection(db, 'submissions'));
      const submissionsList = [];
      subSnap.forEach(d => {
        submissionsList.push({ submissionId: d.id, ...d.data() });
      });
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

  // Handle Group Creation
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!groupName || !groupPass) return;
    setFormLoading(true);

    try {
      const newGroup = {
        name: groupName,
        description: groupDesc,
        passcode: groupPass,
        isPublic: groupPublic,
        ownerId: currentUser.uid,
        members: [],
        pendingApprovals: [],
        bannedUsers: [],
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'groups'), newGroup);
      
      // Reset form
      setGroupName('');
      setGroupDesc('');
      setGroupPass('');
      setGroupPublic(true);
      
      await loadTeacherData();
    } catch (err) {
      console.error(err);
      alert("Failed to create group container.");
    } finally {
      setFormLoading(false);
    }
  };

  // Handle Assignment Creation
  const handleCreateAssignment = async (e) => {
    e.preventDefault();
    if (!assignName || !assignStart || !assignDue || !selectedGroup) return;
    setFormLoading(true);

    try {
      const newAssignment = {
        groupId: selectedGroup.groupId,
        name: assignName,
        description: assignDesc,
        allowedTypes,
        shareVisibility,
        startDate: Timestamp.fromDate(new Date(assignStart)),
        dueDate: Timestamp.fromDate(new Date(assignDue)),
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'assignments'), newAssignment);

      // Reset
      setAssignName('');
      setAssignDesc('');
      setAssignStart('');
      setAssignDue('');
      
      await loadTeacherData();
    } catch (err) {
      console.error(err);
      alert("Failed to structure assignment.");
    } finally {
      setFormLoading(false);
    }
  };

  // Group Roster Governance Actions
  const handleUpdateRoster = async (groupId, action, studentId) => {
    const groupRef = doc(db, 'groups', groupId);
    const group = groups.find(g => g.groupId === groupId);
    if (!group) return;

    let { members = [], pendingApprovals = [], bannedUsers = [] } = group;

    if (action === 'approve') {
      pendingApprovals = pendingApprovals.filter(id => id !== studentId);
      if (!members.includes(studentId)) {
        members.push(studentId);
      }
    } else if (action === 'kick') {
      members = members.filter(id => id !== studentId);
    } else if (action === 'ban') {
      members = members.filter(id => id !== studentId);
      pendingApprovals = pendingApprovals.filter(id => id !== studentId);
      if (!bannedUsers.includes(studentId)) {
        bannedUsers.push(studentId);
      }
    }

    try {
      await updateDoc(groupRef, { members, pendingApprovals, bannedUsers });
      // Update local state
      setGroups(prev => prev.map(g => g.groupId === groupId ? { ...g, members, pendingApprovals, bannedUsers } : g));
      if (selectedGroup?.groupId === groupId) {
        setSelectedGroup(prev => ({ ...prev, members, pendingApprovals, bannedUsers }));
      }
    } catch (err) {
      console.error(err);
      alert("Roster update failed.");
    }
  };

  // Parallel JSZip Compilation
  const handleDownloadAll = async (assignment) => {
    const assignSubs = submissions.filter(s => s.assignmentId === assignment.assignmentId);
    if (assignSubs.length === 0) {
      alert("No student submissions recorded for this assignment.");
      return;
    }

    setZipLoading(true);
    try {
      const zip = new JSZip();
      
      // Parallel fetch using Promise.all
      const promises = assignSubs.map(async (sub) => {
        try {
          const response = await fetch(sub.fileUrl);
          if (!response.ok) throw new Error("Network issue fetching URL");
          const blob = await response.blob();
          
          // Deduce suffix
          const cleanName = sub.fileName || `file`;
          zip.file(`${sub.studentName}_${cleanName}`, blob);
        } catch (fetchErr) {
          console.error(`CORS or connection failure fetching submission for ${sub.studentName}:`, fetchErr);
          // If fetch fails (CORS, network), write a placeholder file
          zip.file(`${sub.studentName}_FETCH_FAILED_READ_LINK.txt`, `Direct Link: ${sub.fileUrl}`);
        }
      });

      await Promise.all(promises);
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Trigger browser file download
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

  const copyToClipboard = (text, groupId) => {
    navigator.clipboard.writeText(text);
    setCopiedGroupCode(groupId);
    setTimeout(() => setCopiedGroupCode(null), 2000);
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}><Users size={28} /></div>
        <p>Loading teacher configuration and mapping student rosters...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Teacher Command Dashboard</h1>
        <p className="dashboard-subtitle">Manage class containers, evaluate student submissions, and compile work directories.</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          My Classes & Rosters
        </button>
        <button 
          className={`tab-btn ${activeTab === 'assignments' ? 'active' : ''}`}
          onClick={() => setActiveTab('assignments')}
        >
          Assignments & Submissions
        </button>
      </div>

      {activeTab === 'groups' && (
        <div className="grid-columns-2">
          {/* Create Group Form */}
          <div className="glass section-card">
            <h2 className="section-title">
              <Plus size={20} />
              <span>Instantiate Classroom Group</span>
            </h2>
            <form onSubmit={handleCreateGroup}>
              <div className="form-group">
                <label className="form-label">Classroom Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={groupName} 
                  onChange={(e) => setGroupName(e.target.value)} 
                  placeholder="e.g. Advanced AI Programming" 
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Overview Description</label>
                <textarea 
                  className="form-textarea" 
                  value={groupDesc} 
                  onChange={(e) => setGroupDesc(e.target.value)} 
                  placeholder="Summary of course content and guidelines..." 
                  rows="3" 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Entry Passcode</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={groupPass} 
                  onChange={(e) => setGroupPass(e.target.value)} 
                  placeholder="Unique passcode required to request entry" 
                  required 
                />
              </div>
              <div className="form-group">
                <label className="form-label">Access Model</label>
                <select 
                  className="form-select" 
                  value={groupPublic ? 'public' : 'private'} 
                  onChange={(e) => setGroupPublic(e.target.value === 'public')}
                >
                  <option value="public">Public (Instant joining with passcode)</option>
                  <option value="private">Private (Approval ledger validation required)</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={formLoading}>
                <span>Create Group Container</span>
              </button>
            </form>
          </div>

          {/* Group Listing & Members administration */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="glass section-card">
              <h2 className="section-title">
                <Users size={20} />
                <span>Active Classroom Containers</span>
              </h2>
              {groups.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No classrooms registered yet. Create one on the left.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {groups.map(g => (
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
                      <div className="flex-between">
                        <span style={{ fontWeight: 700, fontSize: '16px' }}>{g.name}</span>
                        <span className={`badge ${g.isPublic ? 'badge-success' : 'badge-pending'}`}>
                          {g.isPublic ? 'Public' : 'Private'}
                        </span>
                      </div>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '8px 0' }}>{g.description || 'No description'}</p>
                      
                      <div className="flex-between" style={{ fontSize: '12px' }}>
                        <span className="flex-gap-10">
                          <strong>Code:</strong> <code>{g.passcode}</code>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '2px 6px', height: 'auto' }}
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(g.passcode, g.groupId); }}
                          >
                            {copiedGroupCode === g.groupId ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span>{(g.members || []).length} active student(s)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedGroup && (
              <div className="glass section-card animate-fade-in">
                <h3 className="section-title" style={{ fontSize: '17px' }}>
                  <Users size={18} />
                  <span>Roster Management: {selectedGroup.name}</span>
                </h3>

                {/* Pending approvals */}
                {selectedGroup.pendingApprovals && selectedGroup.pendingApprovals.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <h4 style={{ fontSize: '13px', color: 'var(--warning)', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Pending Approval Requests ({selectedGroup.pendingApprovals.length})
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedGroup.pendingApprovals.map(uid => {
                        const profile = allUsers[uid] || { name: 'Resolving UID...', email: uid };
                        return (
                          <div key={uid} className="flex-between glass" style={{ padding: '10px 14px', background: 'rgba(245, 158, 11, 0.05)' }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '14px' }}>{profile.name}</div>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profile.email}</div>
                            </div>
                            <div className="flex-gap-10">
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                onClick={() => handleUpdateRoster(selectedGroup.groupId, 'approve', uid)}
                              >
                                <UserCheck size={14} />
                                <span>Accept</span>
                              </button>
                              <button 
                                className="btn btn-danger" 
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                onClick={() => handleUpdateRoster(selectedGroup.groupId, 'ban', uid)}
                              >
                                <AlertOctagon size={14} />
                                <span>Ban</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Active Members */}
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Enrolled Students
                </h4>
                {(!selectedGroup.members || selectedGroup.members.length === 0) ? (
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '8px 0' }}>No students currently enrolled.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedGroup.members.map(uid => {
                      const profile = allUsers[uid] || { name: 'Resolving UID...', email: uid };
                      return (
                        <div key={uid} className="flex-between glass" style={{ padding: '10px 14px' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '14px' }}>{profile.name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profile.email}</div>
                          </div>
                          <div className="flex-gap-10">
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => handleUpdateRoster(selectedGroup.groupId, 'kick', uid)}
                            >
                              <UserX size={14} />
                              <span>Kick</span>
                            </button>
                            <button 
                              className="btn btn-danger" 
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => handleUpdateRoster(selectedGroup.groupId, 'ban', uid)}
                            >
                              <AlertOctagon size={14} />
                              <span>Ban</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Banned Users */}
                {selectedGroup.bannedUsers && selectedGroup.bannedUsers.length > 0 && (
                  <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                    <h4 style={{ fontSize: '13px', color: '#ef4444', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Banned Roster ({selectedGroup.bannedUsers.length})
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {selectedGroup.bannedUsers.map(uid => {
                        const profile = allUsers[uid] || { name: uid };
                        return (
                          <span key={uid} className="badge badge-danger" style={{ textTransform: 'none', padding: '6px 10px' }}>
                            {profile.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'assignments' && (
        <div className="grid-columns-2">
          {/* Create Assignment Form */}
          <div className="glass section-card">
            <h2 className="section-title">
              <Calendar size={20} />
              <span>Define Assignment Objective</span>
            </h2>
            <form onSubmit={handleCreateAssignment}>
              <div className="form-group">
                <label className="form-label">Destination Class</label>
                <select 
                  className="form-select"
                  value={selectedGroup ? selectedGroup.groupId : ''}
                  onChange={(e) => {
                    const group = groups.find(g => g.groupId === e.target.value);
                    setSelectedGroup(group || null);
                  }}
                  required
                >
                  <option value="" disabled>Select Classroom...</option>
                  {groups.map(g => (
                    <option key={g.groupId} value={g.groupId}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Assignment Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={assignName}
                  onChange={(e) => setAssignName(e.target.value)}
                  placeholder="e.g. Lab 1: Cloud Storage Setup"
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Task Parameters / Description</label>
                <textarea 
                  className="form-textarea" 
                  value={assignDesc}
                  onChange={(e) => setAssignDesc(e.target.value)}
                  placeholder="Task instructions. Enter links like https://google.com which will parse securely."
                  rows="4" 
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Allowed File Types</label>
                <div className="form-checkbox-group">
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={allowedTypes.pdf} 
                      onChange={(e) => setAllowedTypes({ ...allowedTypes, pdf: e.target.checked })} 
                    />
                    <span>PDF (.pdf)</span>
                  </label>
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={allowedTypes.image} 
                      onChange={(e) => setAllowedTypes({ ...allowedTypes, image: e.target.checked })} 
                    />
                    <span>Images</span>
                  </label>
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={allowedTypes.video} 
                      onChange={(e) => setAllowedTypes({ ...allowedTypes, video: e.target.checked })} 
                    />
                    <span>Video</span>
                  </label>
                  <label className="checkbox-label">
                    <input 
                      type="checkbox" 
                      checked={allowedTypes.codeOrDoc} 
                      onChange={(e) => setAllowedTypes({ ...allowedTypes, codeOrDoc: e.target.checked })} 
                    />
                    <span>Code/Doc</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input 
                    type="checkbox" 
                    checked={shareVisibility} 
                    onChange={(e) => setShareVisibility(e.target.checked)} 
                  />
                  <strong>Submission Peer Sharing</strong> (Let students view classmates' submissions)
                </label>
              </div>

              <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label className="form-label">Start Date</label>
                  <input 
                    type="datetime-local" 
                    className="form-input" 
                    value={assignStart} 
                    onChange={(e) => setAssignStart(e.target.value)}
                    required 
                  />
                </div>
                <div>
                  <label className="form-label">Due Date</label>
                  <input 
                    type="datetime-local" 
                    className="form-input" 
                    value={assignDue} 
                    onChange={(e) => setAssignDue(e.target.value)}
                    required 
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={formLoading || !selectedGroup}>
                <span>Deploy Assignment</span>
              </button>
            </form>
          </div>

          {/* Assignments List & Submissions evaluation */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="glass section-card">
              <h2 className="section-title">
                <Calendar size={20} />
                <span>Active Assignments</span>
              </h2>
              {assignments.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No assignments created yet. Choose a class and build one.</div>
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
                        <div className="flex-between">
                          <span style={{ fontWeight: 700 }}>{a.name}</span>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Class: {group?.name || 'Unknown'}</span>
                        </div>
                        <div className="flex-between" style={{ marginTop: '12px', fontSize: '12px' }}>
                          <span>Due: {formatDate(a.dueDate)}</span>
                          <span className="badge badge-info">{subCount} Submissions</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedAssignment && (
              <div className="glass section-card animate-fade-in">
                <div className="flex-between" style={{ marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '17px', margin: 0 }}>
                    Submissions: {selectedAssignment.name}
                  </h3>
                  <div className="flex-gap-10">
                    <button 
                      className="btn btn-secondary"
                      onClick={() => onOpenChat(selectedAssignment)}
                      title="Open assignment discussion chatroom"
                    >
                      <MessageSquare size={14} />
                      <span>Chat</span>
                    </button>
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleDownloadAll(selectedAssignment)}
                      disabled={zipLoading}
                      title="Compile and download all files as a single .zip"
                    >
                      <FileArchive size={14} />
                      <span>{zipLoading ? 'Compiling ZIP...' : 'Download All'}</span>
                    </button>
                  </div>
                </div>

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
                          <th>File Submission</th>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
