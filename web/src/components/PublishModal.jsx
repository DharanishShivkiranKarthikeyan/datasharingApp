import React, { useState } from 'react';
import { useDHT } from '../hooks/useDHT.js';
import { useToast } from './ToastContext.jsx';

const PublishModal = ({ onClose }) => {
  const { publishSnippet } = useDHT();
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [price, setPrice] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await publishSnippet(title, description, tags, content, { files: file ? [file] : [] });
      showToast('Snippet published successfully!');
      onClose();
    } catch (error) {
      showToast(`Publish failed: ${error.message}`, true);
    }
  };

  return (
    <div className="modal-overlay active">
      <div className="publish-card space-y-6">
        <span className="close-btn" onClick={onClose}>×</span>
        <div>
          <h2 className="text-2xl font-bold text-center text-[#D1D5DB]">Publish a Snippet</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Share your code, ideas, or creations with the Dcrypt community.
          </p>
        </div>
        <form id="publishForm" className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="modalTitleInput" className="block text-sm font-medium text-gray-300">Title</label>
            <input
              id="modalTitleInput"
              name="title"
              type="text"
              required
              className="input-field mt-1 block w-full px-4 py-3 placeholder-gray-500"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="modalDescriptionInput" className="block text-sm font-medium text-gray-300">Description</label>
            <textarea
              id="modalDescriptionInput"
              name="description"
              rows="4"
              required
              className="input-field mt-1 block w-full px-4 py-3 placeholder-gray-500"
              placeholder="Describe your snippet"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="modalTagsInput" className="block text-sm font-medium text-gray-300">Tags (comma-separated)</label>
            <input
              id="modalTagsInput"
              name="tags"
              type="text"
              className="input-field mt-1 block w-full px-4 py-3 placeholder-gray-500"
              placeholder="e.g., javascript, python, css"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="modalContentInput" className="block text-sm font-medium text-gray-300">Content</label>
            <textarea
              id="modalContentInput"
              name="content"
              rows="4"
              className="input-field mt-1 block w-full px-4 py-3 placeholder-gray-500"
              placeholder="Type Your Content (Or Upload File)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="modalFileInput" className="block text-sm font-medium text-gray-300">Choose File</label>
            <div className="mt-1 flex items-center">
              <label className="input-field px-4 py-3 cursor-pointer flex items-center">
                <span id="modalFileLabel" className="text-gray-500">
                  {file ? file.name : 'No file chosen'}
                </span>
                <input
                  id="modalFileInput"
                  name="file-upload"
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files[0])}
                />
                <span className="ml-3 text-gray-400"><i className="fas fa-upload"></i></span>
              </label>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <input
                id="modalPremium"
                name="premium"
                type="checkbox"
                className="h-4 w-4 text-[#F59E0B] focus:ring-[#F59E0B] border-gray-300 rounded"
                checked={isPremium}
                onChange={(e) => setIsPremium(e.target.checked)}
              />
              <label htmlFor="modalPremium" className="ml-2 block text-sm text-gray-300">Premium</label>
            </div>
            <input
              id="modalPriceInput"
              type="number"
              placeholder="Price (DCT)"
              min="0"
              step="0.01"
              className={`input-field max-w-[150px] px-3 py-2 ${isPremium ? '' : 'hidden'}`}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <button
              type="submit"
              className="publish-btn w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium focus:outline-none"
            >
              Publish
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PublishModal;