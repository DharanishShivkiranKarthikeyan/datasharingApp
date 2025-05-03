import React, { useState, useEffect } from 'react';
import { publishSnippet } from '../utils/helpers';

function Publish({ dht, user, showToast }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [price, setPrice] = useState('');

  useEffect(() => {
    const vantaEffect = window.VANTA.TOPOLOGY({
      el: document.body,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 800,
      minWidth: 400,
      scale: 1.00,
      scaleMobile: 1.00,
      color: 0x00DDEB,
      backgroundColor: 0x1E2A44,
      speed: 10.0
    });
    return () => vantaEffect.destroy();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!dht || !user) {
      showToast('Please sign in to publish.', true);
      return;
    }
    try {
      const fileInput = { files: file ? [file] : [] };
      await publishSnippet(title, description, tags, content, fileInput, isPremium, price, dht, user, showToast);
      setTitle('');
      setDescription('');
      setTags('');
      setContent('');
      setFile(null);
      setIsPremium(false);
      setPrice('');
    } catch (error) {
      console.error('Publish failed:', error);
      showToast(`Publish failed: ${error.message}`, true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl w-full space-y-8 p-8 bg-gray-800 bg-opacity-90 rounded-lg shadow-lg border border-gray-600">
        <div>
          <h2 className="text-3xl font-bold text-center text-white">Publish a Snippet</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Share your code, ideas, or creations with the Dcrypt community.
          </p>
        </div>
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-300">Title</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="mt-1 block w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:border-purple-500 focus:ring focus:ring-purple-500 placeholder-gray-500"
              placeholder="Enter the title of your snippet"
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-300">Description</label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              className="mt-1 block w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:border-purple-500 focus:ring focus:ring-purple-500 placeholder-gray-500"
              rows="4"
              placeholder="Describe your snippet"
            ></textarea>
          </div>
          <div>
            <label htmlFor="tags" className="block text-sm font-medium text-gray-300">Tags (comma-separated)</label>
            <input
              id="tags"
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="mt-1 block w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:border-purple-500 focus:ring focus:ring-purple-500 placeholder-gray-500"
              placeholder="e.g., javascript, python, css"
            />
          </div>
          <div>
            <label htmlFor="content" className="block text-sm font-medium text-gray-300">Content</label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              className="mt-1 block w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:border-purple-500 focus:ring focus:ring-purple-500 placeholder-gray-500"
              rows="4"
              placeholder="Type Your Content (Or Upload File)"
            ></textarea>
          </div>
          <div>
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-300">Choose File</label>
            <div className="mt-1 flex items-center">
              <label className="px-4 py-3 bg-gray-700 rounded-lg cursor-pointer flex items-center">
                <span className="text-gray-500">{file ? file.name : 'No file chosen'}</span>
                <input
                  id="file-upload"
                  type="file"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="hidden"
                />
                <span className="ml-3 text-gray-400"><i className="fas fa-upload"></i></span>
              </label>
            </div>
          </div>
          <div className="flex items-center">
            <input
              id="premium"
              type="checkbox"
              checked={isPremium}
              onChange={(e) => setIsPremium(e.target.checked)}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
            />
            <label htmlFor="premium" className="ml-2 block text-sm text-gray-300">Premium</label>
          </div>
          {isPremium && (
            <div>
              <label htmlFor="price" className="block text-sm font-medium text-gray-300">Price (DCT)</label>
              <input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1 block w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:border-purple-500 focus:ring focus:ring-purple-500 placeholder-gray-500"
                placeholder="Enter price in DCT"
              />
            </div>
          )}
          <div>
            <button
              type="submit"
              className="w-full bg-purple-500 text-white py-3 px-4 rounded-lg hover:bg-purple-600 focus:outline-none"
            >
              Publish
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Publish;