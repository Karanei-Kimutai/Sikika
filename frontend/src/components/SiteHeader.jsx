import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { LogOut, Menu, User, X } from "lucide-react";
import NotificationBell from "./NotificationBell";
import SikikaLogo from "./SikikaLogo";
import { getToken } from "../utils/auth";
import { prettifyLabel } from "../pages/ngo-admin/helpers";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * SiteHeader
 * ----------
 * Shared top navigation for public, survivor/staff, and admin sessions.
 *
 * Important behavior:
 * - primary nav tabs are role-aware
 * - admins do not use quick action buttons; they navigate via section tabs/routes
 * - the Profile nav tab and standalone Sign Out button have been folded into
 *   a single circular avatar dropdown (see "Profile dropdown" below) to keep
 *   the nav and header-actions row uncluttered
 * - notification bell is shown for all authenticated users; polling and
 *   panel state are encapsulated inside NotificationBell
 * - hamburger drawer activates on narrow viewports (≤ 680px)
 * - nav pill is horizontally scrollable; hovering near the left/right edges
 *   auto-scrolls so all items are reachable without a scrollbar being visible
 */
function SiteHeader({ currentPath, onNavigate, isAuthenticated, role, onSignOut }) {
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef(null);
  const toggleRef = useRef(null);
  // Tracks the rAF handle so scroll animation can be cancelled cleanly.
  const scrollRafRef = useRef(null);

  // --- Profile dropdown state ---------------------------------------
  // Replaces the old standalone Profile nav tab + Sign Out button with a
  // single circular avatar that opens a popover: profile summary on top,
  // Sign Out pinned at the bottom.
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSummary, setProfileSummary] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const menuRef = useRef(null);
  const menuToggleRef = useRef(null);

  const navItems = (() => {
    if (!isAuthenticated) {
      return [
        { path: "/", label: "Home" },
        { path: "/library", label: "Library" }
      ];
    }

    if (role === "NGO_ADMIN") {
      return [
        { path: "/home", label: "Home" },
        { path: "/reports", label: "Case Queue" },
        { path: "/moderation", label: "Moderation Desk" },
        { path: "/community", label: "Community Chat" },
        { path: "/staff", label: "Staffing" },
        { path: "/ussd-callbacks", label: "USSD Callbacks" },
        { path: "/library", label: "Resources" }
      ];
    }

    if (role === "MODERATOR") {
      // Moderator scope is intentionally narrow: Moderation Desk + Community
      // Chat oversight only — a delegated subset of NGO Admin responsibilities.
      // No separate "Home" tab: /home and /moderation both render the same
      // ModerationDashboardPage (there's no distinct landing page for this
      // role), so a dedicated Home link would just duplicate this one.
      return [
        { path: "/moderation", label: "Moderation Desk" },
        { path: "/community", label: "Community Chat" }
      ];
    }

    return [
      { path: "/", label: "Home" },
      { path: "/library", label: "Library" },
      { path: "/reports", label: "Reports" },
      { path: "/chat", label: "Direct Chat" },
      { path: "/community", label: "Community" },
      // USSD callback auto-routing only ever assigns COUNSELLOR — survivors
      // and legal counsel have no callbacks to manage here.
      ...(role === "COUNSELLOR" ? [{ path: "/callbacks", label: "My Callbacks" }] : [])
    ];
  })();

  /** Close drawer on click outside nav or toggle button */
  useEffect(() => {
    if (!navOpen) return;

    const handleOutsideClick = (e) => {
      if (
        navRef.current && !navRef.current.contains(e.target) &&
        toggleRef.current && !toggleRef.current.contains(e.target)
      ) {
        setNavOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [navOpen]);

  /** Close drawer on Escape key */
  useEffect(() => {
    if (!navOpen) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navOpen]);

  /** Close the profile popover on click outside it or its toggle button. */
  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsideClick = (e) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target) &&
        menuToggleRef.current && !menuToggleRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [menuOpen]);

  /** Close the profile popover on Escape key. */
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  /**
   * Lazily loads the signed-in user's profile summary (phone, role, status)
   * the first time the popover is opened, reusing the same `/api/profile/me`
   * endpoint ManageProfilePage.jsx uses. Cheap one-shot fetch — no need to
   * refetch on every open since these fields rarely change mid-session.
   */
  const loadProfileSummary = useCallback(async () => {
    if (profileSummary || profileLoading) return;
    setProfileLoading(true);
    try {
      const token = getToken();
      const response = await axios.get(`${API_BASE_URL}/api/profile/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      // Keep the full payload (user + assignedStaff), not just `user` — survivors
      // need assignedStaff (their counsellor/legal counsel contact numbers) below.
      setProfileSummary(response.data || null);
    } catch {
      // Silent failure — the popover falls back to showing just the role prop.
      setProfileSummary(null);
    } finally {
      setProfileLoading(false);
    }
  }, [profileSummary, profileLoading]);

  const handleAvatarClick = () => {
    setMenuOpen((open) => {
      const next = !open;
      if (next) loadProfileSummary();
      return next;
    });
  };

  const handleManageProfile = () => {
    setMenuOpen(false);
    onNavigate("/profile");
  };

  const handleMenuSignOut = () => {
    setMenuOpen(false);
    onSignOut();
  };

  /**
   * Edge-hover auto-scroll for the nav pill.
   * When the pointer is within EDGE_ZONE px of either end, scroll at a speed
   * proportional to how close the pointer is to the edge (faster = closer).
   */
  const stopScroll = useCallback(() => {
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);

  const handleNavMouseMove = useCallback((e) => {
    const nav = navRef.current;
    if (!nav) return;

    const EDGE_ZONE = 48; // px from either edge that triggers scrolling
    const MAX_SPEED = 8;  // px per frame at the very edge

    const { left, width } = nav.getBoundingClientRect();
    const x = e.clientX - left;

    let speed = 0;
    if (x < EDGE_ZONE) {
      // Left zone — scroll left, faster the closer to the edge
      speed = -MAX_SPEED * (1 - x / EDGE_ZONE);
    } else if (x > width - EDGE_ZONE) {
      // Right zone — scroll right
      speed = MAX_SPEED * (1 - (width - x) / EDGE_ZONE);
    }

    if (speed === 0) {
      stopScroll();
      return;
    }

    // Kick off an rAF loop only if one isn't already running.
    if (scrollRafRef.current) return;

    const tick = () => {
      if (!navRef.current) return;
      navRef.current.scrollLeft += speed;
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  }, [stopScroll]);

  // Clean up any running animation on unmount.
  useEffect(() => () => stopScroll(), [stopScroll]);

  const handleNavClick = (path) => {
    setNavOpen(false);
    onNavigate(path);
  };

  return (
    <header className="site-header">
      <button type="button" className="brand-mark" onClick={() => onNavigate("/")}>
        <SikikaLogo size={40} className="brand-symbol" decorative />
        <span>
          <strong>Sikika</strong>
          <small>Private help, clear resources</small>
        </span>
      </button>

      <button
        ref={toggleRef}
        type="button"
        className="site-nav-toggle"
        aria-expanded={navOpen}
        aria-controls="primary-nav"
        aria-label="Toggle navigation"
        onClick={() => setNavOpen((open) => !open)}
      >
        {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
      </button>

      {/* Scroll viewport — takes the grid column, clips overflow, drives rAF scroll */}
      <div
        ref={navRef}
        className="site-nav-scroll"
        onMouseMove={handleNavMouseMove}
        onMouseLeave={stopScroll}
      >
        <nav
          id="primary-nav"
          className={`site-nav${navOpen ? " site-nav--open" : ""}`}
          aria-label="Primary navigation"
        >
          {navItems.map((item) => {
            // /home has no dedicated nav tab for NGO_ADMIN ("/" covers it) or
            // MODERATOR (no separate landing page) — alias it to whichever
            // tab represents that role's actual landing destination.
            const isActive =
              currentPath === item.path ||
              (item.path === "/" && currentPath === "/home") ||
              (item.path === "/moderation" && currentPath === "/home" && role === "MODERATOR");
            return (
              <a
                key={item.path}
                href={item.path}
                className={`site-nav-link ${isActive ? "active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(item.path);
                }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>

      <div className="header-actions">
        {!isAuthenticated && (
          <button type="button" className="header-action" onClick={() => onNavigate("/join")}>
            Join Community
          </button>
        )}
        {/* Notification bell — shown for all authenticated roles.
            Encapsulates its own polling and panel state. */}
        <NotificationBell isAuthenticated={isAuthenticated} />
        {isAuthenticated && (
          <div className="profile-dropdown">
            <button
              ref={menuToggleRef}
              type="button"
              className="profile-avatar-btn"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              onClick={handleAvatarClick}
            >
              <User size={20} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div ref={menuRef} className="profile-menu" role="menu">
                <div className="profile-menu-summary">
                  {profileLoading ? (
                    <p className="profile-menu-loading">Loading profile...</p>
                  ) : (
                    <>
                      <p className="profile-menu-role">{prettifyLabel(profileSummary?.user?.role || role)}</p>
                      {/* Survivors reach out to their assigned support staff directly,
                          so show those two numbers instead of their own. Every other
                          role just sees their own contact number. */}
                      {(profileSummary?.user?.role || role) === "SURVIVOR" ? (
                        <>
                          <p className="profile-menu-phone">
                            Counsellor: {profileSummary?.assignedStaff?.counsellor?.phoneNumber || "Not assigned"}
                          </p>
                          <p className="profile-menu-phone">
                            Legal Counsel: {profileSummary?.assignedStaff?.legalCounsel?.phoneNumber || "Not assigned"}
                          </p>
                        </>
                      ) : (
                        <p className="profile-menu-phone">{profileSummary?.user?.phoneNumber || ""}</p>
                      )}
                      {profileSummary?.user?.accountStatus && (
                        <p className="profile-menu-status">{prettifyLabel(profileSummary.user.accountStatus)}</p>
                      )}
                    </>
                  )}
                </div>
                <button type="button" className="profile-menu-item" role="menuitem" onClick={handleManageProfile}>
                  <User size={16} aria-hidden="true" />
                  <span>Manage Profile</span>
                </button>
                <button
                  type="button"
                  className="profile-menu-item profile-menu-signout"
                  role="menuitem"
                  onClick={handleMenuSignOut}
                >
                  <LogOut size={16} aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default SiteHeader;
