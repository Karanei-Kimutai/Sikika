import { useEffect, useMemo, useState } from "react";
import { fallbackCategories, fallbackResources } from "../data/fallbackResources";
import { createResource, deleteResource, getResources, trackResourceAccess, updateResource } from "../services/resources";

const MANAGEMENT_ROLES = new Set(["COUNSELLOR", "LEGAL_COUNSEL", "NGO_ADMIN"]);

function decodeRoleFromToken() {
  const token = localStorage.getItem("authToken");
  if (!token) return "";

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.role || "").toUpperCase();
  } catch {
    return "";
  }
}

function getCurrentUserId() {
  const explicitUserId = localStorage.getItem("userId");
  if (explicitUserId) return explicitUserId;

  const token = localStorage.getItem("authToken");
  if (!token) return "";

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return String(payload.userId || payload.id || "");
  } catch {
    return "";
  }
}

/**
 * Public resource library page.
 *
 * Resources are loaded from the backend when available. During early
 * development, the page falls back to local sample resources so the UI remains
 * usable before the database/API is running.
 */
function matchesResource(resource, searchQuery, category) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchableText = [
    resource.title,
    resource.description,
    resource.categoryLabel,
    resource.category
  ].join(" ").toLowerCase();

  return (
    (!normalizedSearch || searchableText.includes(normalizedSearch)) &&
    (category === "all" || resource.category === category)
  );
}

function LibraryPage() {
  const role = decodeRoleFromToken();
  const currentUserId = getCurrentUserId();
  const canManageResources = MANAGEMENT_ROLES.has(role);
  const isNgoAdmin = role === "NGO_ADMIN";

  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [managementError, setManagementError] = useState("");
  const [managementSuccess, setManagementSuccess] = useState("");

  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createFile, setCreateFile] = useState(null);
  const [createFileInputKey, setCreateFileInputKey] = useState(0);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editFile, setEditFile] = useState(null);
  const [editFileInputKey, setEditFileInputKey] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  async function handleResourceOpen(resource) {
    try {
      if (resource?.id) {
        await trackResourceAccess(resource.id);
      }
    } catch {
      // Analytics should never block resource access.
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadResources() {
      setLoading(true);
      setErrorMessage("");

      try {
        const data = await getResources({
          search: searchQuery,
          category: selectedCategory
        });

        if (!isMounted) return;

        // Backend returns already-filtered resources and the complete category list.
        setResources(data.resources || []);
        setCategories(data.categories || []);
      } catch {
        if (!isMounted) return;

        // Local fallback mirrors the backend filters for development previews.
        setResources(fallbackResources.filter((resource) => matchesResource(resource, searchQuery, selectedCategory)));
        setCategories(fallbackCategories);
        setErrorMessage("Showing sample resources because the backend resource API is not available.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadResources();

    return () => {
      isMounted = false;
    };
  }, [searchQuery, selectedCategory]);

  const visibleCategories = useMemo(() => {
    // Always include "All" even when the API has no uploaded resources yet.
    const source = categories.length > 0 ? categories : fallbackCategories;
    return [{ value: "all", label: "All" }, ...source];
  }, [categories]);

  const editableCategoryOptions = useMemo(() => {
    const values = visibleCategories.map((category) => category.value).filter((value) => value !== "all");
    return [...new Set(values)];
  }, [visibleCategories]);

  const managedResources = useMemo(() => {
    if (!canManageResources || !currentUserId) return [];
    return resources.filter((resource) => resource.uploaderId === currentUserId);
  }, [canManageResources, currentUserId, resources]);

  async function reloadResourcesForCurrentFilters() {
    const data = await getResources({
      search: searchQuery,
      category: selectedCategory
    });

    setResources(data.resources || []);
    setCategories(data.categories || []);
  }

  function clearManagementNotices() {
    setManagementError("");
    setManagementSuccess("");
  }

  function startEdit(resource) {
    clearManagementNotices();
    setEditingId(resource.id);
    setEditTitle(resource.title || "");
    setEditDescription(resource.description || "");
    setEditCategory(resource.category || "");
    setEditFile(null);
    setEditFileInputKey((value) => value + 1);
  }

  function cancelEdit() {
    setEditingId("");
    setEditTitle("");
    setEditDescription("");
    setEditCategory("");
    setEditFile(null);
  }

  async function handleCreateResource(event) {
    event.preventDefault();
    clearManagementNotices();

    if (!createTitle.trim() || !createCategory.trim() || !createFile) {
      setManagementError("Title, category, and file are required to upload a resource.");
      return;
    }

    setCreating(true);

    try {
      await createResource({
        title: createTitle.trim(),
        description: createDescription.trim(),
        category: createCategory.trim(),
        file: createFile
      });

      setCreateTitle("");
      setCreateDescription("");
      setCreateCategory("");
      setCreateFile(null);
      setCreateFileInputKey((value) => value + 1);
      setManagementSuccess("Resource uploaded successfully.");
      await reloadResourcesForCurrentFilters();
    } catch (error) {
      setManagementError(error.response?.data?.error || "Failed to upload resource.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(resourceId) {
    clearManagementNotices();

    if (!editTitle.trim() || !editCategory.trim()) {
      setManagementError("Title and category are required when saving changes.");
      return;
    }

    setUpdating(true);

    try {
      await updateResource(resourceId, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        category: editCategory.trim(),
        file: editFile
      });

      setManagementSuccess("Resource updated successfully.");
      cancelEdit();
      await reloadResourcesForCurrentFilters();
    } catch (error) {
      setManagementError(error.response?.data?.error || "Failed to update resource.");
    } finally {
      setUpdating(false);
    }
  }

  async function handleDeleteResource(resource) {
    clearManagementNotices();

    if (!window.confirm(`Delete resource \"${resource.title}\"? This action cannot be undone.`)) {
      return;
    }

    setDeletingId(resource.id);

    try {
      await deleteResource(resource.id);
      setManagementSuccess("Resource deleted successfully.");
      if (editingId === resource.id) {
        cancelEdit();
      }
      await reloadResourcesForCurrentFilters();
    } catch (error) {
      setManagementError(error.response?.data?.error || "Failed to delete resource.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main className="library-page">
      <section className="library-intro">
        <div>
          <p className="eyebrow">Resource library</p>
          <h1>Find guides, contacts, and support documents</h1>
          <p>
            Search by topic or filter by category. Public resources can be viewed before creating an account.
          </p>
        </div>
        <div className="library-count">
          <strong>{resources.length}</strong>
          <span>{resources.length === 1 ? "resource" : "resources"} available</span>
        </div>
      </section>

      <section className="library-toolbar" aria-label="Resource filters">
        <label htmlFor="resource-search">
          Search resources
          <input
            id="resource-search"
            type="search"
            placeholder="Search by title, topic, or category"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>

        <div className="category-tabs" role="tablist" aria-label="Resource categories">
          {visibleCategories.map((category) => (
            <button
              key={category.value}
              type="button"
              className={selectedCategory === category.value ? "active" : ""}
              onClick={() => setSelectedCategory(category.value)}
            >
              {category.label}
            </button>
          ))}
        </div>
      </section>

      {canManageResources && (
        <section className="resource-management-panel" aria-label="Resource management">
          <div className="resource-management-heading">
            <h2>Manage resources</h2>
            <p>Upload resources and manage only the files you uploaded.</p>
          </div>

          <form className="resource-management-form" onSubmit={handleCreateResource}>
            <label htmlFor="resource-title-input">
              Title
              <input
                id="resource-title-input"
                type="text"
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="e.g. Safety Planning Checklist"
              />
            </label>

            <label htmlFor="resource-category-input">
              Category
              <input
                id="resource-category-input"
                list="resource-category-options"
                type="text"
                value={createCategory}
                onChange={(event) => setCreateCategory(event.target.value)}
                placeholder="e.g. legal_guidance"
              />
            </label>

            <label htmlFor="resource-description-input" className="resource-management-span-full">
              Description
              <textarea
                id="resource-description-input"
                rows={3}
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Optional short summary shown in the library"
              />
            </label>

            <label htmlFor="resource-file-input" className="resource-management-span-full">
              Resource file
              <input
                key={createFileInputKey}
                id="resource-file-input"
                type="file"
                onChange={(event) => setCreateFile(event.target.files?.[0] || null)}
              />
            </label>

            <button type="submit" className="primary-btn resource-management-span-full" disabled={creating}>
              {creating ? "Uploading..." : "Upload resource"}
            </button>

            <datalist id="resource-category-options">
              {editableCategoryOptions.map((categoryValue) => (
                <option key={categoryValue} value={categoryValue} />
              ))}
            </datalist>
          </form>
        </section>
      )}

      {!canManageResources && role && (
        <p className="status-message">You can browse resources. Staff upload and editing controls are role-restricted.</p>
      )}

      {managementError && <p className="status-message warning">{managementError}</p>}
      {managementSuccess && <p className="status-message success">{managementSuccess}</p>}

      {canManageResources && !loading && managedResources.length === 0 && (
        <p className="status-message">You have not uploaded any resources yet. Upload one above to manage it here.</p>
      )}

      {errorMessage && <p className="status-message warning">{errorMessage}</p>}
      {loading && <p className="status-message">Loading resources...</p>}

      {!loading && resources.length === 0 ? (
        <section className="empty-state">
          <h2>No resources found</h2>
          <p>Try a different search term or clear the category filter.</p>
          <button type="button" className="secondary-btn" onClick={() => {
            setSearchQuery("");
            setSelectedCategory("all");
          }}>
            Clear filters
          </button>
        </section>
      ) : (
        <section className="resource-grid" aria-label="Available resources">
          {resources.map((resource) => (
            <article className="resource-tile" key={resource.id}>
              <div>
                <span className="resource-category">{resource.categoryLabel}</span>
                <h2>{resource.title}</h2>
                <p>{resource.description || "Open this resource to view the full support material."}</p>
              </div>

              <div className="resource-tile-actions">
                <a
                  className="tile-action"
                  href={resource.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => handleResourceOpen(resource)}
                >
                  View / Download
                </a>

                {canManageResources && editingId !== resource.id && (
                  <div className="resource-manager-actions">
                    {resource.uploaderId === currentUserId && (
                      <button type="button" className="secondary-btn" onClick={() => startEdit(resource)}>
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary-btn resource-delete-btn"
                      onClick={() => handleDeleteResource(resource)}
                      disabled={deletingId === resource.id || (!isNgoAdmin && resource.uploaderId !== currentUserId)}
                    >
                      {deletingId === resource.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                )}

                {canManageResources && resource.uploaderId === currentUserId && editingId === resource.id && (
                  <div className="resource-edit-panel">
                    <label htmlFor={`edit-title-${resource.id}`}>
                      Title
                      <input
                        id={`edit-title-${resource.id}`}
                        type="text"
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                      />
                    </label>

                    <label htmlFor={`edit-category-${resource.id}`}>
                      Category
                      <input
                        id={`edit-category-${resource.id}`}
                        list="resource-category-options"
                        type="text"
                        value={editCategory}
                        onChange={(event) => setEditCategory(event.target.value)}
                      />
                    </label>

                    <label htmlFor={`edit-description-${resource.id}`}>
                      Description
                      <textarea
                        id={`edit-description-${resource.id}`}
                        rows={3}
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                      />
                    </label>

                    <label htmlFor={`edit-file-${resource.id}`}>
                      Replace file (optional)
                      <input
                        key={`resource-edit-file-${resource.id}-${editFileInputKey}`}
                        id={`edit-file-${resource.id}`}
                        type="file"
                        onChange={(event) => setEditFile(event.target.files?.[0] || null)}
                      />
                    </label>

                    <div className="resource-manager-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => handleSaveEdit(resource.id)}
                        disabled={updating}
                      >
                        {updating ? "Saving..." : "Save changes"}
                      </button>
                      <button type="button" className="secondary-btn" onClick={cancelEdit} disabled={updating}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

export default LibraryPage;
