

/**
 * Parses a string and converts URLs to React anchor tags securely, 
 * avoiding any use of innerHTML.
 */
export function parseDescriptionLinks(text) {
  if (!text) return '';
  // Match URLs starting with http:// or https://
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="parsed-link"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

/**
 * Validates a file name against allowed category checklists.
 */
export function validateFileType(fileName, allowedTypes) {
  if (!fileName || !allowedTypes) return false;
  
  const ext = fileName.slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
  
  if (allowedTypes.pdf && ext === 'pdf') {
    return true;
  }
  
  const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (allowedTypes.image && imgExts.includes(ext)) {
    return true;
  }
  
  const videoExts = ['mp4', 'mkv', 'mov'];
  if (allowedTypes.video && videoExts.includes(ext)) {
    return true;
  }
  
  const codeDocExts = ['py', 'js', 'java', 'docx', 'xlsx', 'txt', 'zip'];
  if (allowedTypes.codeOrDoc && codeDocExts.includes(ext)) {
    return true;
  }
  
  return false;
}

/**
 * Standardizes date formatting to visual representation
 */
export function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  // Check if it's a Firestore Timestamp
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}
