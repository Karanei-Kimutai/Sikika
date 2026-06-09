import { useEffect, useMemo, useState } from "react";
import { fallbackCategories, fallbackResources } from "../data/fallbackResources";
import { getResources } from "../services/resources";

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
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

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
              <a className="tile-action" href={resource.fileUrl} target="_blank" rel="noreferrer">
                View / Download
              </a>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

export default LibraryPage;
