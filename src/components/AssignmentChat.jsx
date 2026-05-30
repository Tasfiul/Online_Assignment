import { useEffect, useRef, useState } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from 'firebase/firestore';
import { Send, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/helpers';

export default function AssignmentChat({ assignment, onClose }) {
  const { currentUser, userProfile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!assignment) return;

    // Real-time listener: Order by timestamp
    const q = query(
      collection(db, 'chats'),
      where('assignmentId', '==', assignment.assignmentId),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = [];
      snapshot.forEach((doc) => {
        msgs.push({ messageId: doc.id, ...doc.data() });
      });
      setMessages(msgs);
      // Timeout ensures DOM updates before scroll
      setTimeout(scrollToBottom, 50);
    }, (err) => {
      console.error("Firestore onSnapshot error:", err);
      // If the error is about a missing index, log a helpful message
      if (err.code === 'failed-precondition') {
        console.error(
          "This query requires a composite index. " +
          "Deploy indexes with: npx firebase deploy --only firestore:indexes"
        );
      }
    });

    // Tear down subscription on unmount
    return () => unsubscribe();
  }, [assignment]);

  // Handle message submission
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !currentUser || !userProfile || sending) return;

    const messageText = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      await addDoc(collection(db, 'chats'), {
        assignmentId: assignment.assignmentId,
        senderId: currentUser.uid,
        senderName: userProfile.name || currentUser.displayName || 'Anonymous',
        senderRole: userProfile.role,
        text: messageText,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to append chat record:", err);
      alert("Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const getRoleClass = (role) => {
    switch (role) {
      case 'admin': return 'role-admin';
      case 'teacher': return 'role-teacher';
      default: return 'role-student';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal-content glass animate-fade-in" 
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', height: '80vh', padding: 0 }}
      >
        {/* Header */}
        <div className="flex-between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', background: 'rgba(15, 22, 38, 0.9)' }}>
          <div>
            <h3 style={{ fontSize: '16px', margin: 0 }}>Assignment Forum</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Discussion for "{assignment.name}"</span>
          </div>
          <button 
            style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer' }}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="chat-messages" style={{ flexGrow: 1, overflowY: 'auto' }}>
          {messages.length === 0 ? (
            <div className="empty-state" style={{ height: '100%', justifyContent: 'center' }}>
              <p style={{ color: 'var(--text-muted)' }}>No messages yet. Send a message to start the classroom discussion!</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.senderId === currentUser.uid;
              return (
                <div 
                  key={msg.messageId} 
                  className={`chat-bubble ${isOwn ? 'own' : 'other'}`}
                >
                  <div className="chat-bubble-header" style={{ justifyContent: isOwn ? 'flex-end' : 'flex-start' }}>
                    <span className="sender-name">{msg.senderName}</span>
                    <span className={`sender-role ${getRoleClass(msg.senderRole)}`}>
                      {msg.senderRole}
                    </span>
                  </div>
                  <div className="chat-bubble-text">
                    {msg.text}
                  </div>
                  <span className="chat-bubble-time">
                    {msg.timestamp ? formatDate(msg.timestamp) : 'Sending...'}
                  </span>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <form onSubmit={handleSendMessage} className="chat-input-area">
          <input
            type="text"
            className="form-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message here..."
            maxLength={1000}
            required
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '10px 16px' }} disabled={sending}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
