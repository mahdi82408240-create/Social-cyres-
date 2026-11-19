(() => {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const postsContainer = $("#postsContainer");
  const modal = $("#postModal");
  const textarea = $("#postText");
  const toast = $("#toast");
  let selectedImage = "";
  let editingPostId = null;
  let posts = [];
  let activeUser = null;
  let socialRealtimeChannel = null;
  let unreadNotifications = 0;
  let viewedProfileId = null;
  let viewedProfile = null;
  let previousViewBeforePublicProfile = "home";
  let viewedProfilePosts = [];
  let selectedConversationId = null;
  let selectedChatUser = null;
  let messagesRealtimeChannel = null;
  let mediaRecorder = null;
  let voiceChunks = [];
  let voiceStream = null;
  let recordingStartedAt = 0;
  let replyToMessage = null;
  let chatMessagesCache = [];

  const defaultProfile = {
    name: "کاربر سایرس",
    bio: "دارم لحظه‌ها رو جمع می‌کنم؛ ایده‌ها رو می‌سازم و مسیر خودم رو می‌رم. ✨",
    avatar: "https://i.pravatar.cc/100?img=12"
  };
  // اطلاعات هویتی هر حساب فقط از Supabase خوانده می‌شود؛
  // از یک localStorage مشترک برای چند حساب استفاده نمی‌کنیم.
  let userProfile = { ...defaultProfile, username: "cyrus_user" };

  const persianNumber = n => Number(n).toLocaleString("fa-IR");
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  // احراز هویت واقعی با Supabase Auth
  let authMode = "login";
  const authGate = $("#authGate");
  const authForm = $("#authForm");
  const authMessage = $("#authMessage");
  function setAuthMessage(message, type = "info") {
    authMessage.textContent = message;
    authMessage.dataset.type = type;
  }
  function setAuthMode(mode) {
    authMode = mode;
    $$("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
    $("#authNameField").hidden = mode !== "signup";
    $("#authEmailField").hidden = mode === "recovery";
    $("#authTabs").hidden = mode === "recovery";
    $("#authTitle").textContent = mode === "signup" ? "به سایرس ملحق شو" : mode === "recovery" ? "رمز تازه انتخاب کن" : "به سایرس خوش اومدی";
    $("#authSubmit").innerHTML = mode === "signup" ? 'ساخت حساب <span>←</span>' : mode === "recovery" ? 'ذخیره رمز جدید <span>←</span>' : 'ورود به حساب <span>←</span>' ;
    $("#authPassword").autocomplete = mode === "signup" || mode === "recovery" ? "new-password" : "current-password";
    $("#forgotPassword").hidden = mode !== "login";
    setAuthMessage("");
  }
  function showAuthGate(show) {
    authGate.classList.toggle("open", Boolean(show));
    authGate.setAttribute("aria-hidden", show ? "false" : "true");
    document.body.classList.toggle("auth-locked", Boolean(show));
  }
  async function initializeAuth() {
    if (!window.CYRUS_DB_READY) {
      setAuthMessage("برای فعال شدن ورود و ثبت‌نام، ابتدا URL و کلید عمومی Supabase را در js/config.js وارد کن.", "error");
      showAuthGate(false);
      return;
    }
    showAuthGate(true);
    setAuthMessage("در حال بررسی وضعیت حساب...");
    try {
      const { data, error } = await window.cyrusSupabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user) {
        activeUser = data.session.user;
        showAuthGate(false);
        await loadProfileFromSupabase();
        await loadPostsFromSupabase();
        await initializeSocialFeatures();
      } else {
        setAuthMode("login");
        setAuthMessage("برای ادامه وارد حساب شو یا ثبت‌نام کن.");
      }
    } catch (error) {
      console.error("Auth initialization failed:", error);
      setAuthMessage(error.message || "بررسی حساب ناموفق بود.", "error");
    }
    window.cyrusSupabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showAuthGate(true);
        setAuthMode("recovery");
        setAuthMessage("رمز عبور جدیدت را وارد کن.");
      } else if (session?.user) {
        const previousUserId = activeUser?.id || null;
        activeUser = session.user;
        showAuthGate(false);
        if (event === "SIGNED_IN" || event === "USER_UPDATED") {
          // هنگام تعویض حساب، گفت‌وگوی حساب قبلی نباید در حساب جدید باقی بماند.
          if (previousUserId && previousUserId !== session.user.id) {
            selectedConversationId = null;
            selectedChatUser = null;
            if (messagesRealtimeChannel) window.cyrusSupabase.removeChannel(messagesRealtimeChannel);
            messagesRealtimeChannel = null;
            if ($("#activeChat")) $("#activeChat").hidden = true;
            if ($("#chatEmpty")) $("#chatEmpty").hidden = false;
          }
          Promise.resolve().then(async () => {
            await loadProfileFromSupabase();
            await loadPostsFromSupabase();
            await initializeSocialFeatures();
            if (event === "SIGNED_IN") await loadInbox();
          });
        }
      } else if (event === "SIGNED_OUT") {
        activeUser = null;
        selectedConversationId = null;
        selectedChatUser = null;
        if (messagesRealtimeChannel) window.cyrusSupabase.removeChannel(messagesRealtimeChannel);
        messagesRealtimeChannel = null;
        if ($("#chatMessages")) $("#chatMessages").innerHTML = "";
        if ($("#activeChat")) $("#activeChat").hidden = true;
        if ($("#chatEmpty")) $("#chatEmpty").hidden = false;
        posts = [];
        if (socialRealtimeChannel) window.cyrusSupabase.removeChannel(socialRealtimeChannel);
        socialRealtimeChannel = null;
        renderPosts();
        showAuthGate(true);
        setAuthMode("login");
        setAuthMessage("از حساب خارج شدی. برای ادامه دوباره وارد شو.");
      }
    });
  }
  $$("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!window.CYRUS_DB_READY) return setAuthMessage("تنظیمات Supabase کامل نیست؛ فایل js/config.js را بررسی کن.", "error");
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    const displayName = $("#authName").value.trim();
    if ((authMode !== "recovery" && !email) || !password || password.length < 6) return setAuthMessage(authMode === "recovery" ? "رمز جدید باید حداقل ۶ کاراکتر باشد." : "ایمیل معتبر و رمز عبور حداقل ۶ کاراکتری وارد کن.", "error");
    if (authMode === "signup" && displayName.length < 2) return setAuthMessage("نام نمایشی باید حداقل ۲ حرف داشته باشد.", "error");
    const submit = $("#authSubmit");
    submit.disabled = true;
    submit.textContent = authMode === "signup" ? "در حال ساخت حساب..." : authMode === "recovery" ? "در حال تغییر رمز..." : "در حال ورود...";
    try {
      if (authMode === "recovery") {
        const { error } = await window.cyrusSupabase.auth.updateUser({ password });
        if (error) throw error;
        setAuthMode("login");
        setAuthMessage("رمز عبور با موفقیت تغییر کرد. حالا می‌تونی وارد بشی.", "success");
      } else if (authMode === "signup") {
        const username = usernameFromEmail(email);
        const { data, error } = await window.cyrusSupabase.auth.signUp({
          email, password, options: { emailRedirectTo: location.origin + location.pathname, data: { display_name: displayName, username } }
        });
        if (error) throw error;
        if (data.session?.user) {
          setAuthMessage("حساب ساخته شد؛ خوش اومدی!", "success");
          showAuthGate(false);
          await loadProfileFromSupabase();
        } else {
          setAuthMode("login");
          setAuthMessage("ثبت‌نام انجام شد. ایمیلت رو باز کن و لینک تأیید Supabase رو بزن؛ بعد از تأیید می‌تونی وارد بشی.", "success");
        }
      } else {
        const { error } = await window.cyrusSupabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setAuthMessage("ورود موفق بود.", "success");
      }
    } catch (error) {
      console.error("Authentication failed:", error);
      const messages = {
        "Invalid login credentials": "ایمیل یا رمز عبور اشتباه است.",
        "Email not confirmed": "ابتدا ایمیلت را از طریق لینک تأیید کن.",
        "User already registered": "این ایمیل قبلاً ثبت‌نام کرده است؛ وارد حساب شو.",
        "Password should be at least 6 characters": "رمز عبور باید حداقل ۶ کاراکتر باشد."
      };
      setAuthMessage(messages[error.message] || error.message || "عملیات ناموفق بود.", "error");
    } finally {
      submit.disabled = false;
      submit.innerHTML = authMode === "signup" ? 'ساخت حساب <span>←</span>' : authMode === "recovery" ? 'ذخیره رمز جدید <span>←</span>' : 'ورود به حساب <span>←</span>';
    }
  });
  function usernameFromEmail(email) {
    const base = (email.split("@")[0] || "cyrus_user").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 16) || "cyrus_user";
    return `${base}_${Math.random().toString(36).slice(2, 6)}`;
  }
  $("#forgotPassword").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    if (!email) return setAuthMessage("اول ایمیلت رو وارد کن.", "error");
    try {
      const { error } = await window.cyrusSupabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      setAuthMessage("لینک بازیابی رمز عبور به ایمیلت ارسال شد.", "success");
    } catch (error) { setAuthMessage(error.message || "ارسال لینک بازیابی ناموفق بود.", "error"); }
  });
  $("#signOutBtn").addEventListener("click", async () => {
    if (!window.cyrusSupabase) return;
    const { error } = await window.cyrusSupabase.auth.signOut();
    if (error) { console.error(error); showToast("خروج از حساب ناموفق بود."); }
  });

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }
  function applyProfile() {
    const avatarSelectors = ["#sidebarAvatar", "#topAvatar", "#composerAvatar", "#summaryAvatar", "#profileAvatar"];
    avatarSelectors.forEach(selector => { const image = $(selector); if (image) image.src = userProfile.avatar; });
    const nameSelectors = ["#sidebarName", "#summaryName", "#profileName"];
    nameSelectors.forEach(selector => { const node = $(selector); if (node) node.textContent = userProfile.name; });
    const bioSelectors = ["#summaryBio", "#profileBio"];
    bioSelectors.forEach(selector => { const node = $(selector); if (node) node.textContent = userProfile.bio; });
    $$(".modal-user b").forEach(node => node.textContent = userProfile.name);
    $$(".modal-user img").forEach(image => image.src = userProfile.avatar);
    // پست‌های محلی خود کاربر هم هویت به‌روز را نمایش می‌دهند.
    posts.filter(post => post.handle === "cyrus_user").forEach(post => { post.name = userProfile.name; post.avatar = userProfile.avatar; });
  }
  function openEditProfile() {
    $("#editDisplayName").value = userProfile.name;
    $("#editBio").value = userProfile.bio;
    $("#editAvatarPreview").src = userProfile.avatar;
    $("#bioCharCount").textContent = `${persianNumber(userProfile.bio.length)} / ۱۶۰`;
    $("#editProfileModal").classList.add("open");
    $("#editProfileModal").setAttribute("aria-hidden", "false");
    setTimeout(() => $("#editDisplayName").focus(), 80);
  }
  function closeEditProfile() {
    $("#editProfileModal").classList.remove("open");
    $("#editProfileModal").setAttribute("aria-hidden", "true");
  }
  function resizeProfileImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const canvas = document.createElement("canvas");
          const size = 480;
          const scale = Math.min(size / image.width, size / image.height, 1);
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }


  // پروفایل آنلاین: فقط برای کاربری که در Supabase وارد شده باشد.
  async function getSignedInUser() {
    if (!window.cyrusSupabase) return null;
    const { data, error } = await window.cyrusSupabase.auth.getUser();
    if (error) throw error;
    return data.user || null;
  }

  function usernameFromUser(user) {
    const metaName = user.user_metadata?.username;
    if (metaName) return String(metaName).toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24) || `user_${user.id.slice(0, 8)}`;
    const emailName = (user.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
    return emailName || `user_${user.id.slice(0, 8)}`;
  }

  async function loadProfileFromSupabase() {
    if (!window.CYRUS_DB_READY) return;
    try {
      const user = await getSignedInUser();
      if (!user) return;
      activeUser = user;
      const { data, error } = await window.cyrusSupabase
        .from("profiles").select("id, username, display_name, bio, avatar_url")
        .eq("id", user.id).maybeSingle();
      if (error) throw error;
      if (data) {
        userProfile = {
          name: data.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "کاربر سایرس",
          bio: data.bio || "",
          avatar: data.avatar_url || defaultProfile.avatar,
          username: data.username || usernameFromUser(user)
        };
        applyProfile();
      } else {
        const initialProfile = {
          id: user.id,
          username: usernameFromUser(user),
          display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "کاربر سایرس",
          bio: "",
          avatar_url: null
        };
        const { error: insertError } = await window.cyrusSupabase.from("profiles").insert(initialProfile);
        if (insertError && insertError.code !== "23505") throw insertError;
        userProfile = {
          name: initialProfile.display_name,
          bio: initialProfile.bio,
          avatar: defaultProfile.avatar,
          username: initialProfile.username
        };
        applyProfile();
      }
    } catch (error) {
      console.error("Supabase profile load failed:", error);
      showToast(`دریافت پروفایل ناموفق بود: ${error.message || error.code || "خطای نامشخص"}`);
    }
  }

  async function uploadProfileAvatar(user, dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const filePath = `${user.id}/avatar-${Date.now()}.jpg`;
    const { error: uploadError } = await window.cyrusSupabase.storage
      .from("profile-avatars").upload(filePath, blob, { contentType: "image/jpeg", upsert: true });
    if (uploadError) throw uploadError;
    const { data } = window.cyrusSupabase.storage.from("profile-avatars").getPublicUrl(filePath);
    return data.publicUrl;
  }

  function renderPosts(list = posts, target = postsContainer) {
    target.innerHTML = "";
    if (!list.length) {
      target.innerHTML = '<div class="post-card empty-state">هنوز پستی منتشر نشده؛ اولین پستت رو منتشر کن. ✦</div>';
      return;
    }
    list.forEach(post => {
      const card = document.createElement("article");
      card.className = "post-card";
      card.dataset.id = post.id;
      card.dataset.ownerId = post.userId || "";
      card.innerHTML = `
        <div class="post-head">
          <button class="post-author-link" type="button" data-open-profile="${escapeHTML(post.userId || "")}" aria-label="مشاهده پروفایل ${escapeHTML(post.name || "کاربر")}"><img src="${escapeHTML(post.avatar || defaultProfile.avatar)}" alt=""><span class="post-author"><b>${escapeHTML(post.name || "کاربر سایرس")}</b><span>@${escapeHTML(post.handle || "user")}</span></span></button>
          <span class="post-time">${escapeHTML(post.time || "")}</span>
          ${post.userId === activeUser?.id ? `<div class="post-menu-wrap"><button class="post-more" type="button" data-post-menu-toggle aria-label="گزینه‌های پست" aria-expanded="false">⋯</button><div class="post-menu" data-post-menu hidden><button type="button" data-action="edit-post"><span>✎</span> ویرایش پست</button><button type="button" class="danger" data-action="delete-post"><span>⌫</span> حذف پست</button></div></div>` : ""}
        </div>
        ${post.text ? `<p class="post-text">${escapeHTML(post.text).replace(/\n/g,"<br>")}</p>` : ""}
        ${post.image ? `<img class="post-image" src="${escapeHTML(post.image)}" alt="تصویر پست" loading="lazy">` : ""}
        <div class="post-actions">
          <button class="post-action like-action ${post.liked ? "liked" : ""}" data-action="like"><span class="action-icon">${post.liked ? "♥" : "♡"}</span><span>${persianNumber(post.likes || 0)}</span></button>
          <button class="post-action" data-action="comment"><span class="action-icon">◯</span><span>${persianNumber(post.comments || 0)} دیدگاه</span></button>
          <button class="post-action ${post.saved ? "saved" : ""}" data-action="save"><span class="action-icon">${post.saved ? "▣" : "♧"}</span><span>ذخیره</span></button>
          <button class="post-action" data-action="share"><span class="action-icon">↗</span><span>اشتراک</span></button>
        </div>
        <section class="comments-panel" data-comments hidden>
          <div class="comments-list"><p class="comment-empty">در حال دریافت دیدگاه‌ها...</p></div>
          <form class="comment-form" data-comment-form>
            <input name="comment" type="text" maxlength="1000" placeholder="دیدگاهت رو بنویس..." required>
            <button type="submit">ارسال</button>
          </form>
        </section>`;
      target.appendChild(card);
    });
  }

  function relativeTime(value) {
    if (!value) return "";
    return new Date(value).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  }

  async function loadPostsFromSupabase() {
    if (!window.CYRUS_DB_READY || !activeUser) return;
    postsContainer.innerHTML = '<div class="post-card empty-state">در حال دریافت پست‌ها...</div>';
    const { data, error } = await window.cyrusSupabase
      .from("posts")
      .select(`id,user_id,content,image_url,created_at,profiles!posts_user_id_fkey(id,username,display_name,avatar_url),likes(user_id),comments(id)`)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      console.error("Loading posts failed:", error);
      postsContainer.innerHTML = `<div class="post-card empty-state">دریافت پست‌ها ناموفق بود: ${escapeHTML(error.message)}</div>`;
      return;
    }
    posts = (data || []).map(row => {
      const profile = row.profiles || {};
      return {
        id: row.id,
        userId: row.user_id,
        name: profile.display_name || profile.username || "کاربر سایرس",
        handle: profile.username || "user",
        avatar: profile.avatar_url || defaultProfile.avatar,
        time: relativeTime(row.created_at),
        text: row.content || "",
        image: row.image_url || "",
        likes: row.likes?.length || 0,
        comments: row.comments?.length || 0,
        liked: (row.likes || []).some(item => item.user_id === activeUser.id),
        saved: false
      };
    });
    renderPosts();
    if (!$("#profilePage").hidden) renderProfilePosts();
  }

  async function uploadPostImage(user, dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await window.cyrusSupabase.storage.from("post-images").upload(path, blob, {
      contentType: blob.type || "image/jpeg", upsert: false
    });
    if (error) throw error;
    const { data } = window.cyrusSupabase.storage.from("post-images").getPublicUrl(path);
    return data.publicUrl;
  }

  async function loadComments(postId, panel) {
    const list = $(".comments-list", panel);
    list.innerHTML = '<p class="comment-empty">در حال دریافت دیدگاه‌ها...</p>';
    const { data, error } = await window.cyrusSupabase
      .from("comments")
      .select("id,user_id,body,created_at,profiles!comments_user_id_fkey(username,display_name,avatar_url)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (error) {
      list.innerHTML = `<p class="comment-empty">${escapeHTML(error.message)}</p>`;
      return;
    }
    if (!data?.length) {
      list.innerHTML = '<p class="comment-empty">هنوز دیدگاهی ثبت نشده.</p>';
      return;
    }
    const card = panel.closest(".post-card");
    const canModerate = card?.dataset.ownerId === activeUser?.id;
    list.innerHTML = data.map(comment => {
      const profile = comment.profiles || {};
      const isMine = comment.user_id === activeUser?.id;
      const canManage = isMine || canModerate;
      return `<article class="comment-item" data-comment-id="${escapeHTML(comment.id)}" data-comment-user="${escapeHTML(comment.user_id)}"><img src="${escapeHTML(profile.avatar_url || defaultProfile.avatar)}" alt=""><div class="comment-content"><b>${escapeHTML(profile.display_name || profile.username || "کاربر")}</b><p data-comment-body>${escapeHTML(comment.body)}</p><small>${escapeHTML(relativeTime(comment.created_at))}</small></div>${canManage ? `<div class="comment-menu-wrap"><button class="comment-more" type="button" data-comment-menu-toggle aria-label="مدیریت دیدگاه" aria-expanded="false">⋯</button><div class="comment-menu" data-comment-menu hidden>${isMine ? `<button type="button" data-comment-action="edit">ویرایش</button>` : ""}<button type="button" class="danger" data-comment-action="delete">حذف</button></div></div>` : ""}</article>`;
    }).join("");
  }

  async function submitComment(form, postId) {
    const input = $("input[name=comment]", form);
    const body = input.value.trim();
    if (!body) return;
    if (!activeUser) return showToast("برای ثبت دیدگاه وارد حساب شو.");
    const button = $("button[type=submit]", form);
    button.disabled = true;
    try {
      const { error } = await window.cyrusSupabase.from("comments").insert({
        post_id: postId, user_id: activeUser.id, body
      });
      if (error) throw error;
      input.value = "";
      const post = posts.find(item => item.id === postId) || viewedProfilePosts.find(item => item.id === postId);
      if (post) post.comments += 1;
      const panel = form.closest(".comments-panel");
      await loadComments(postId, panel);
      renderPosts();
      if (!$("#profilePage").hidden) renderProfilePosts();
      if (!$("#publicProfilePage").hidden) renderPosts(viewedProfilePosts, $("#publicProfilePosts"));
    } catch (error) {
      console.error("Comment insert failed:", error);
      showToast(`ثبت دیدگاه ناموفق بود: ${error.message || "خطا"}`);
    } finally {
      button.disabled = false;
    }
  }

  function openModal() {
    editingPostId = null;
    selectedImage = "";
    textarea.value = "";
    $("#imagePreview").innerHTML = "";
    $("#postImage").value = "";
    $("#modalTitle").textContent = "ایجاد پست";
    $("#publishPost").innerHTML = 'انتشار پست <span>↗</span>';
    $("#publishHint").textContent = "پست برای دنبال‌کننده‌ها و کاربران Social Cyrus نمایش داده می‌شود.";
    $("#charCount").textContent = "۰ / ۶۰۰";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    setTimeout(() => textarea.focus(), 80);
  }
  function openEditPost(post) {
    if (!activeUser || post.userId !== activeUser.id) return showToast("فقط صاحب پست می‌تواند آن را ویرایش کند.");
    editingPostId = post.id;
    selectedImage = "";
    textarea.value = post.text || "";
    $("#imagePreview").innerHTML = post.image ? `<img src="${escapeHTML(post.image)}" alt="تصویر فعلی پست">` : "";
    $("#postImage").value = "";
    $("#modalTitle").textContent = "ویرایش پست";
    $("#publishPost").innerHTML = 'ذخیره تغییرات <span>✓</span>';
    $("#publishHint").textContent = "متن پست را اصلاح کن؛ تصویر فعلی بدون تغییر باقی می‌ماند.";
    $("#charCount").textContent = `${persianNumber(textarea.value.length)} / ۶۰۰`;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    setTimeout(() => textarea.focus(), 80);
  }
  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden","true");
    editingPostId = null;
  }
  ["#openComposer","#composerPrompt","#mobileCreate"].forEach(sel => $(sel).addEventListener("click", openModal));
  $("#closeModal").addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeEditProfile(); } });

  textarea.addEventListener("input", () => {
    $("#charCount").textContent = `${persianNumber(textarea.value.length)} / ۶۰۰`;
  });
  $("#postImage").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("لطفاً یک فایل تصویری انتخاب کن.");
    if (file.size > 5 * 1024 * 1024) return showToast("حجم تصویر باید کمتر از ۵ مگابایت باشد.");
    const reader = new FileReader();
    reader.onload = () => {
      selectedImage = reader.result;
      $("#imagePreview").innerHTML = `<img src="${selectedImage}" alt="پیش‌نمایش تصویر">`;
    };
    reader.readAsDataURL(file);
  });

  async function publishPost() {
    const text = textarea.value.trim();
    const editingPost = editingPostId ? (posts.find(item => item.id === editingPostId) || viewedProfilePosts.find(item => item.id === editingPostId)) : null;
    if (!text && !selectedImage && !(editingPost && editingPost.image)) return showToast("متن یا تصویر پست را وارد کن.");
    if (!window.CYRUS_DB_READY || !activeUser) return showToast("برای انتشار آنلاین ابتدا وارد حساب شو.");
    const button = $("#publishPost");
    const isEditing = Boolean(editingPostId);
    button.disabled = true;
    button.textContent = isEditing ? "در حال ذخیره..." : "در حال انتشار...";
    try {
      if (isEditing) {
        const { error } = await window.cyrusSupabase.from("posts").update({ content: text }).eq("id", editingPostId).eq("user_id", activeUser.id);
        if (error) throw error;
        await loadPostsFromSupabase();
        closeModal();
        showToast("تغییرات پست ذخیره شد.");
      } else {
        let imageUrl = null;
        if (selectedImage) imageUrl = await uploadPostImage(activeUser, selectedImage);
        const { error } = await window.cyrusSupabase.from("posts").insert({
          user_id: activeUser.id,
          content: text,
          image_url: imageUrl
        });
        if (error) throw error;
        await loadPostsFromSupabase();
        textarea.value = "";
        $("#charCount").textContent = "۰ / ۶۰۰";
        $("#imagePreview").innerHTML = "";
        selectedImage = "";
        $("#postImage").value = "";
        closeModal();
        showToast("پست با موفقیت در Social Cyrus منتشر شد.");
      }
    } catch (error) {
      console.error("Post publish failed:", error);
      showToast(`انتشار پست ناموفق بود: ${error.message || "خطا"}`);
    } finally {
      button.disabled = false;
      button.innerHTML = 'انتشار پست <span>↗</span>';
    }
  }
  $("#publishPost").addEventListener("click", publishPost);

  // ---------------- PUBLIC PROFILES ----------------
  function hideMainViews() {
    $(".content-grid").hidden = true;
    ["#profilePage", "#explorePage", "#notificationsPage", "#publicProfilePage", "#messagesPage"].forEach(id => { if ($(id)) $(id).hidden = true; });
  }
  async function openPublicProfile(userId) {
    if (!userId) return;
    if (!$("#publicProfilePage").hidden) return;
    previousViewBeforePublicProfile = !$("#explorePage").hidden ? "explore" : !$("#notificationsPage").hidden ? "notifications" : !$("#messagesPage").hidden ? "messages" : !$("#profilePage").hidden ? "profile" : "home";
    if (userId === activeUser?.id) {
      $('[data-view="profile"]')?.click();
      return;
    }
    hideMainViews();
    $("#publicProfilePage").hidden = false;
    $("#pageTitle").textContent = "پروفایل کاربر";
    $("#publicProfilePosts").innerHTML = '<div class="feature-empty">در حال دریافت پروفایل...</div>';
    viewedProfileId = userId;
    try {
      const db = window.cyrusSupabase;
      const [{ data: profile, error }, { count: followers, error: followersError }, { count: following, error: followingError }, { data: relation, error: relationError }, { data: userPosts, error: postsError }] = await Promise.all([
        db.from("profiles").select("id,username,display_name,bio,avatar_url,created_at").eq("id", userId).maybeSingle(),
        db.from("follows").select("follower_id", {count:"exact",head:true}).eq("following_id", userId),
        db.from("follows").select("following_id", {count:"exact",head:true}).eq("follower_id", userId),
        db.from("follows").select("following_id").eq("follower_id", activeUser.id).eq("following_id", userId).maybeSingle(),
        db.from("posts").select("id,user_id,content,image_url,created_at,profiles!posts_user_id_fkey(id,username,display_name,avatar_url),likes(user_id),comments(id)").eq("user_id", userId).order("created_at",{ascending:false}).limit(60)
      ]);
      if (error) throw error;
      if (followersError) throw followersError;
      if (followingError) throw followingError;
      if (relationError) throw relationError;
      if (postsError) throw postsError;
      if (!profile) throw new Error("این پروفایل پیدا نشد.");
      viewedProfile = profile;
      const name = profile.display_name || profile.username || "کاربر سایرس";
      const avatar = profile.avatar_url || defaultProfile.avatar;
      $("#publicProfileAvatar").src = avatar;
      $("#publicProfileName").textContent = name;
      $("#publicProfileHandle").textContent = `@${profile.username || "user"}`;
      $("#publicProfileBio").textContent = profile.bio || "هنوز بیوگرافی‌ای ننوشته است.";
      $("#publicProfileJoined").textContent = profile.created_at ? `عضویت از ${new Date(profile.created_at).toLocaleDateString("fa-IR")}` : "";
      $("#publicPostCount").textContent = persianNumber(userPosts?.length || 0);
      $("#publicFollowerCount").textContent = persianNumber(followers || 0);
      $("#publicFollowingCount").textContent = persianNumber(following || 0);
      const followButton = $("#publicFollowButton");
      followButton.dataset.followUser = userId;
      followButton.dataset.following = String(Boolean(relation));
      followButton.classList.toggle("following", Boolean(relation));
      followButton.textContent = relation ? "دنبال می‌کنی" : "دنبال کردن";
      viewedProfilePosts = (userPosts || []).map(row => ({
        id:row.id,userId:row.user_id,name:row.profiles?.display_name || row.profiles?.username || name,
        handle:row.profiles?.username || profile.username || "user",avatar:row.profiles?.avatar_url || avatar,
        time:relativeTime(row.created_at),text:row.content || "",image:row.image_url || "",
        likes:row.likes?.length || 0,comments:row.comments?.length || 0,
        liked:(row.likes || []).some(item => item.user_id === activeUser.id),saved:false
      }));
      renderPosts(viewedProfilePosts, $("#publicProfilePosts"));
    } catch (error) {
      console.error("Public profile load failed:", error);
      $("#publicProfilePosts").innerHTML = `<div class="feature-empty">دریافت پروفایل ناموفق بود: ${escapeHTML(error.message || "خطا")}</div>`;
    }
  }
  $("#backFromPublicProfile").addEventListener("click", () => {
    hideMainViews();
    const view = previousViewBeforePublicProfile;
    $("#pageTitle").textContent = ({home:"خانه",explore:"اکسپلور",notifications:"اعلان‌ها",messages:"پیام‌ها",profile:"پروفایل من"})[view] || "خانه";
    if (view === "home") $(".content-grid").hidden = false;
    else if (view === "explore") { $("#explorePage").hidden = false; loadPeople($("#explorePeople"),40); }
    else if (view === "notifications") { $("#notificationsPage").hidden = false; loadNotifications(); }
    else if (view === "messages") { $("#messagesPage").hidden = false; loadInbox(); }
    else if (view === "profile") { $("#profilePage").hidden = false; renderProfilePosts(); }
  });
  $("#publicProfilePosts").addEventListener("click", handlePostAction);
  $("#publicProfilePosts").addEventListener("submit", handleCommentSubmit);
  $("#publicMessageButton").addEventListener("click", () => {
    if (!viewedProfileId) return;
    startDirectConversation(viewedProfileId, viewedProfile);
  });
  $("#publicShareButton").addEventListener("click", () => {
    const url = `${location.href.split("#")[0]}#user=${viewedProfileId}`;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast("لینک پروفایل کپی شد."));
    else showToast(url);
  });

  // ---------------- DIRECT MESSAGES ----------------
  async function startDirectConversation(otherUserId, profile = null) {
    if (!activeUser || !window.CYRUS_DB_READY) return showToast("برای ارسال پیام ابتدا وارد حساب شو.");
    if (otherUserId === activeUser.id) return showToast("نمی‌تونی به خودت پیام بدی.");
    try {
      let person = profile;
      if (!person) {
        const {data,error} = await window.cyrusSupabase.from("profiles").select("id,username,display_name,avatar_url").eq("id",otherUserId).single();
        if (error) throw error;
        person = data;
      }
      const {data:conversationId,error} = await window.cyrusSupabase.rpc("cyrus_get_or_create_conversation", {p_other_user:otherUserId});
      if (error) throw error;
      selectedChatUser = person;
      selectedConversationId = conversationId;
      hideMainViews();
      $("#messagesPage").hidden = false;
      $("#pageTitle").textContent = "پیام‌ها";
      $("#chatEmpty").hidden = true;
      $("#activeChat").hidden = false;
      $("#chatUserAvatar").src = person.avatar_url || defaultProfile.avatar;
      $("#chatUserName").textContent = person.display_name || person.username || "کاربر سایرس";
      $("#chatUserHandle").textContent = `@${person.username || "user"}`;
      await loadChatMessages();
      await loadInbox();
      subscribeToChatChannel(conversationId);
      $("#chatInput").focus();
    } catch (error) {
      console.error("Start conversation failed:", error);
      showToast(`باز کردن دایرکت ناموفق بود: ${error.message || "خطا"}`);
    }
  }
  async function markIncomingMessagesRead() {
    if (!selectedConversationId || !activeUser) return;
    const { error } = await window.cyrusSupabase.from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", selectedConversationId)
      .neq("sender_id", activeUser.id)
      .is("read_at", null);
    if (error) console.warn("Could not mark messages as read:", error);
  }

  function subscribeToChatChannel(conversationId) {
    if (messagesRealtimeChannel) window.cyrusSupabase.removeChannel(messagesRealtimeChannel);
    const channel = window.cyrusSupabase.channel(`cyrus-chat-${conversationId}`, {
      config: { presence: { key: activeUser.id } }
    });
    channel
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => loadChatMessages())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => loadChatMessages())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => loadChatMessages())
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const online = Object.values(state).flat().some(entry => entry.user_id === selectedChatUser?.id);
        const status = $("#chatUserStatus");
        if (status) {
          status.textContent = online ? "آنلاین" : "آفلاین";
          status.classList.toggle("is-online", online);
        }
      })
      .subscribe(async status => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: activeUser.id, online_at: new Date().toISOString() });
        }
      });
    messagesRealtimeChannel = channel;
  }

  async function loadChatMessages() {
    if (!selectedConversationId) return;
    // شناسه حساب را از نشست معتبر Supabase می‌گیریم، نه فقط از state قبلی صفحه.
    // این کار جلوی رنگ‌گرفتن پیام‌ها بر اساس حساب قبلی پس از تعویض حساب را می‌گیرد.
    const conversationAtRequest = selectedConversationId;
    const { data: authData, error: authError } = await window.cyrusSupabase.auth.getUser();
    if (authError) { console.error(authError); return; }
    if (!authData?.user) return;
    activeUser = authData.user;
    const viewerId = String(authData.user.id).toLowerCase();
    const {data,error} = await window.cyrusSupabase.from("messages")
      .select("id,sender_id,body,created_at,read_at,media_path,media_type,file_name,mime_type,file_size,reply_to_id,is_forwarded").eq("conversation_id",conversationAtRequest).order("created_at",{ascending:true}).limit(150);
    if (error) { console.error(error); return showToast(`دریافت پیام‌ها ناموفق بود: ${error.message || "خطا"}`); }
    if (selectedConversationId !== conversationAtRequest || activeUser?.id !== authData.user.id) return;
    chatMessagesCache = data || [];
    const parentIds = [...new Set(chatMessagesCache.map(m => m.reply_to_id).filter(Boolean))];
    let parentMap = new Map();
    if (parentIds.length) {
      const { data: parents, error: parentError } = await window.cyrusSupabase.from("messages")
        .select("id,sender_id,body,media_type,media_path,file_name").in("id", parentIds).eq("conversation_id", conversationAtRequest);
      if (!parentError) parentMap = new Map((parents || []).map(m => [m.id, m]));
    }
    const rendered = await Promise.all(chatMessagesCache.map(async message => {
      const mine = String(message.sender_id || "").toLowerCase() === viewerId;
      const receipt = mine ? `<small class="message-receipt ${message.read_at ? "seen" : ""}">${message.read_at ? "✓✓ دیده شد" : "✓ ارسال شد"}</small>` : "";
      let media = "";
      if (message.media_path) {
        const { data: signed, error: signedError } = await window.cyrusSupabase.storage.from("chat-media").createSignedUrl(message.media_path, 3600);
        if (!signedError && signed?.signedUrl) {
          const url = escapeHTML(signed.signedUrl);
          if (message.media_type === "image") media = `<a class="chat-media-link" href="${url}" target="_blank" rel="noopener"><img class="chat-media-image" src="${url}" alt="تصویر ارسال‌شده" loading="lazy"></a>`;
          else if (message.media_type === "video") media = `<video class="chat-media-video" src="${url}" controls playsinline preload="metadata"></video>`;
          else if (message.media_type === "audio") media = `<audio class="chat-audio" controls preload="none" src="${url}"></audio>`;
          else media = `<a class="chat-file-card" href="${url}" target="_blank" rel="noopener" download="${escapeHTML(message.file_name || "download")}"><span>▤</span><span><b>${escapeHTML(message.file_name || "فایل")}</b><small>${formatFileSize(message.file_size)}</small></span><strong>دانلود ↓</strong></a>`;
        } else media = `<p class="chat-media-unavailable">دریافت رسانه ممکن نشد.</p>`;
      }
      const body = message.media_path && message.body === mediaLabel(message.media_type) ? "" : `<p>${escapeHTML(message.body || "").replace(/\n/g,"<br>")}</p>`;
      const parent = message.reply_to_id ? parentMap.get(message.reply_to_id) : null;
      const quoteText = parent ? (parent.media_path ? mediaLabel(parent.media_type) : (parent.body || "پیام")) : "پیام اصلی در دسترس نیست";
      const replyQuote = message.reply_to_id ? `<div class="chat-reply-quote"><b>${parent && String(parent.sender_id).toLowerCase() === viewerId ? "پیام شما" : "پیام مخاطب"}</b><span>${escapeHTML(quoteText).slice(0,110)}</span></div>` : "";
      const forwarded = message.is_forwarded ? `<small class="chat-forwarded-label">↪ فوروارد شده</small>` : "";
      const actions = `<div class="chat-message-menu-wrap ${mine ? "is-mine" : "is-theirs"}"><button type="button" class="chat-message-dots" data-message-menu-toggle aria-label="گزینه‌های پیام" aria-expanded="false" title="گزینه‌ها"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button><div class="chat-message-actions" aria-label="عملیات پیام"><button type="button" class="chat-action-reply" data-message-action="reply" data-message-id="${message.id}" title="پاسخ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v3"/></svg><span>پاسخ</span></button><button type="button" class="chat-action-forward" data-message-action="forward" data-message-id="${message.id}" title="فوروارد"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 7 7-7 7M21 12H9a6 6 0 0 0-6 6"/></svg><span>فوروارد</span></button>${mine ? `<button type="button" class="chat-action-delete" data-message-action="delete" data-message-id="${message.id}" title="حذف پیام"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg><span>حذف</span></button>` : ""}</div></div>`;
      return `<div class="chat-bubble ${mine ? "mine" : "theirs"}" data-message-id="${message.id}">${forwarded}${replyQuote}${media}${body}<time>${new Date(message.created_at).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit"})} ${receipt}</time>${actions}</div>`;
    }));
    if (selectedConversationId !== conversationAtRequest || activeUser?.id !== authData.user.id) return;
    $("#chatMessages").innerHTML = rendered.join("") || '<div class="feature-empty">هنوز پیامی ردوبدل نشده؛ اولین پیام رو بفرست.</div>';
    $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
    await markIncomingMessagesRead();
  }
  async function loadInbox() {
    if (!activeUser) return;
    const target = $("#inboxList");
    target.innerHTML = '<div class="feature-empty">در حال دریافت گفتگوها...</div>';
    try {
      const {data:members,error} = await window.cyrusSupabase.from("conversation_members")
        .select("conversation_id,user_id,profiles!conversation_members_user_id_fkey(id,username,display_name,avatar_url)").eq("user_id",activeUser.id);
      if (error) throw error;
      const ids = [...new Set((members || []).map(row=>row.conversation_id))];
      if (!ids.length) { target.innerHTML = '<div class="feature-empty">هنوز گفت‌وگویی نداری.</div>'; return; }
      const {data:allMembers,error:membersError} = await window.cyrusSupabase.from("conversation_members")
        .select("conversation_id,user_id,profiles!conversation_members_user_id_fkey(id,username,display_name,avatar_url)").in("conversation_id",ids);
      if (membersError) throw membersError;
      const {data:allMessages,error:messagesError} = await window.cyrusSupabase.from("messages")
        .select("conversation_id,body,created_at,sender_id,media_type,media_path").in("conversation_id",ids).order("created_at",{ascending:false});
      if (messagesError) throw messagesError;
      const rows = ids.map(id=>{
        const member=(allMembers||[]).find(row=>row.conversation_id===id && row.user_id!==activeUser.id);
        const last=(allMessages||[]).find(row=>row.conversation_id===id);
        return {id,person:member?.profiles,last};
      }).filter(row=>row.person).sort((a,b)=>new Date(b.last?.created_at||0)-new Date(a.last?.created_at||0));
      target.innerHTML = rows.map(row=>`<button class="inbox-item ${row.id===selectedConversationId?"active":""}" data-chat-id="${row.id}" data-chat-user="${row.person.id}"><img src="${escapeHTML(row.person.avatar_url||defaultProfile.avatar)}" alt=""><span><b>${escapeHTML(row.person.display_name||row.person.username||"کاربر")}</b><small>${escapeHTML(row.last?.media_path ? mediaLabel(row.last.media_type) : (row.last?.body||"گفت‌وگوی جدید"))}</small></span></button>`).join("") || '<div class="feature-empty">هنوز گفت‌وگویی نداری.</div>';
    } catch(error) { console.error("Inbox load failed:",error); target.innerHTML='<div class="feature-empty">دریافت گفتگوها ناموفق بود؛ SQL پیام‌ها را اجرا کن.</div>'; }
  }
  $("#inboxList").addEventListener("click", async event=>{
    const item=event.target.closest("[data-chat-id]"); if(!item) return;
    try {
      const {data,error}=await window.cyrusSupabase.from("profiles").select("id,username,display_name,avatar_url").eq("id",item.dataset.chatUser).single();
      if(error) throw error;
      selectedConversationId=item.dataset.chatId; selectedChatUser=data;
      $("#chatEmpty").hidden=true; $("#activeChat").hidden=false;
      $("#chatUserAvatar").src=data.avatar_url||defaultProfile.avatar;
      $("#chatUserName").textContent=data.display_name||data.username;
      $("#chatUserHandle").textContent=`@${data.username||"user"}`;
      await loadChatMessages(); await loadInbox();
      subscribeToChatChannel(selectedConversationId);
    } catch(error){console.error(error);showToast("باز کردن گفتگو ناموفق بود.");}
  });
  function formatFileSize(bytes = 0) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  function mediaLabel(type) { return type === "image" ? "[عکس]" : type === "video" ? "[ویدئو]" : type === "audio" ? "[پیام صوتی]" : "[فایل]"; }
  function safeExtension(name, fallback = "bin") {
    const ext = String(name || "").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
    return ext && ext.length <= 8 ? ext : fallback;
  }
  function uniqueMediaId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
    return [...bytes].map(value=>value.toString(16).padStart(2,"0")).join("");
  }
  async function sendChatMedia(file, type) {
    if (!file || !selectedConversationId || !activeUser) return;
    const maxBytes = type === "video" ? 50 * 1024 * 1024 : type === "audio" ? 12 * 1024 * 1024 : type === "image" ? 12 * 1024 * 1024 : 25 * 1024 * 1024;
    if (file.size > maxBytes) return showToast(`حجم فایل بیش از حد مجاز است (${formatFileSize(maxBytes)}).`);
    if (type === "image" && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return showToast("فرمت عکس باید JPG، PNG، WEBP یا GIF باشد.");
    if (type === "video" && !["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) return showToast("فرمت ویدئو باید MP4، WEBM یا MOV باشد.");
    const controls = [$("#chatSendButton"), $("#attachImageBtn"), $("#attachFileBtn"), $("#recordVoiceBtn")];
    controls.forEach(button => { if (button) button.disabled = true; });
    let path = "";
    try {
      const ext = safeExtension(file.name, type === "audio" ? "webm" : "bin");
      path = `${selectedConversationId}/${activeUser.id}/${uniqueMediaId()}.${ext}`;
      const { error: uploadError } = await window.cyrusSupabase.storage.from("chat-media").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await window.cyrusSupabase.from("messages").insert({
        conversation_id: selectedConversationId, sender_id: activeUser.id, body: mediaLabel(type),
        reply_to_id: replyToMessage?.id || null, media_path: path, media_type: type, file_name: file.name || (type === "audio" ? "voice-message.webm" : "file"),
        mime_type: file.type || "application/octet-stream", file_size: file.size
      });
      if (error) throw error;
      clearChatReply(); await loadChatMessages(); await loadInbox();
    } catch (error) {
      if (path) await window.cyrusSupabase.storage.from("chat-media").remove([path]);
      console.error("Media message failed:", error);
      showToast(`ارسال رسانه ناموفق بود: ${error.message || "خطا"}`);
    } finally { controls.forEach(button => { if (button) button.disabled = false; }); }
  }
  function clearChatReply() {
    replyToMessage = null;
    const preview = $("#chatReplyPreview");
    if (preview) preview.hidden = true;
    const text = $("#chatReplyText"); if (text) text.textContent = "";
  }
  function setChatReply(message) {
    replyToMessage = message;
    const preview = $("#chatReplyPreview");
    const label = message.media_path ? mediaLabel(message.media_type) : (message.body || "پیام");
    $("#chatReplyText").textContent = label.slice(0, 110);
    preview.hidden = false;
    $("#chatInput").focus();
  }
  $("#cancelChatReply").addEventListener("click", clearChatReply);
  $("#chatMessages").addEventListener("click", async event => {
    const toggle = event.target.closest("[data-message-menu-toggle]");
    if (toggle) {
      const wrap = toggle.closest(".chat-message-menu-wrap");
      const wasOpen = wrap.classList.contains("is-open");
      $("#chatMessages").querySelectorAll(".chat-message-menu-wrap.is-open").forEach(item => {
        item.classList.remove("is-open");
        item.querySelector("[data-message-menu-toggle]")?.setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        wrap.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
      }
      return;
    }
    const button = event.target.closest("[data-message-action]");
    if (!button) {
      if (!event.target.closest(".chat-message-menu-wrap")) {
        $("#chatMessages").querySelectorAll(".chat-message-menu-wrap.is-open").forEach(item => {
          item.classList.remove("is-open");
          item.querySelector("[data-message-menu-toggle]")?.setAttribute("aria-expanded", "false");
        });
      }
      return;
    }
    button.closest(".chat-message-menu-wrap")?.classList.remove("is-open");
    const message = chatMessagesCache.find(item => item.id === button.dataset.messageId);
    if (!message) return;
    const action = button.dataset.messageAction;
    if (action === "reply") return setChatReply(message);
    if (action === "delete") {
      if (String(message.sender_id).toLowerCase() !== String(activeUser?.id).toLowerCase()) return;
      if (!confirm("این پیام برای هر دو طرف حذف شود؟")) return;
      try {
        const { error } = await window.cyrusSupabase.from("messages").delete().eq("id", message.id).eq("sender_id", activeUser.id).eq("conversation_id", selectedConversationId);
        if (error) throw error;
        if (message.media_path) await window.cyrusSupabase.storage.from("chat-media").remove([message.media_path]);
        if (replyToMessage?.id === message.id) clearChatReply();
        await loadChatMessages(); await loadInbox(); showToast("پیام حذف شد.");
      } catch (error) { console.error(error); showToast(`حذف پیام ناموفق بود: ${error.message || "خطا"}`); }
      return;
    }
    if (action === "forward") {
      try {
        const { data: members, error: membersError } = await window.cyrusSupabase.from("conversation_members")
          .select("conversation_id,user_id,profiles!conversation_members_user_id_fkey(id,username,display_name)").eq("user_id", activeUser.id);
        if (membersError) throw membersError;
        const ids = [...new Set((members || []).map(row => row.conversation_id))].filter(id => id !== selectedConversationId);
        if (!ids.length) return showToast("گفت‌وگوی دیگری برای فوروارد وجود ندارد.");
        const { data: allMembers, error: allError } = await window.cyrusSupabase.from("conversation_members")
          .select("conversation_id,user_id,profiles!conversation_members_user_id_fkey(id,username,display_name)").in("conversation_id", ids);
        if (allError) throw allError;
        const choices = ids.map(id => {
          const row = (allMembers || []).find(item => item.conversation_id === id && item.user_id !== activeUser.id);
          return row ? { id, name: row.profiles?.display_name || row.profiles?.username || "کاربر" } : null;
        }).filter(Boolean);
        if (!choices.length) return showToast("مقصد مناسبی پیدا نشد.");
        const choiceText = choices.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
        const answer = prompt(`پیام به کدام گفت‌وگو فوروارد شود؟\n${choiceText}\nشماره مقصد را وارد کن:`);
        if (answer === null) return;
        const index = Number(answer) - 1;
        if (!Number.isInteger(index) || !choices[index]) return showToast("شماره مقصد معتبر نیست.");
        const targetConversation = choices[index].id;
        let mediaPath = null;
        if (message.media_path) {
          const { data: fileData, error: downloadError } = await window.cyrusSupabase.storage.from("chat-media").download(message.media_path);
          if (downloadError) throw downloadError;
          const ext = safeExtension(message.file_name, message.media_type === "audio" ? "webm" : "bin");
          mediaPath = `${targetConversation}/${activeUser.id}/${uniqueMediaId()}.${ext}`;
          const { error: uploadError } = await window.cyrusSupabase.storage.from("chat-media").upload(mediaPath, fileData, { contentType: message.mime_type || fileData.type || "application/octet-stream", upsert: false });
          if (uploadError) throw uploadError;
        }
        const { error: insertError } = await window.cyrusSupabase.from("messages").insert({
          conversation_id: targetConversation, sender_id: activeUser.id,
          body: message.body, media_path: mediaPath, media_type: mediaPath ? message.media_type : null,
          file_name: mediaPath ? message.file_name : null, mime_type: mediaPath ? message.mime_type : null,
          file_size: mediaPath ? message.file_size : null, is_forwarded: true
        });
        if (insertError) {
          if (mediaPath) await window.cyrusSupabase.storage.from("chat-media").remove([mediaPath]);
          throw insertError;
        }
        showToast("پیام فوروارد شد.");
      } catch (error) { console.error(error); showToast(`فوروارد ناموفق بود: ${error.message || "خطا"}`); }
    }
  });

  $("#chatForm").addEventListener("submit",async event=>{
    event.preventDefault(); const input=$("#chatInput"); const body=input.value.trim();
    if(!body||!selectedConversationId||!activeUser) return;
    const button=$("#chatSendButton"); button.disabled=true;
    try {
      const {error}=await window.cyrusSupabase.from("messages").insert({conversation_id:selectedConversationId,sender_id:activeUser.id,body,reply_to_id:replyToMessage?.id || null});
      if(error) throw error;
      input.value=""; clearChatReply(); await loadChatMessages(); await loadInbox();
    } catch(error){console.error(error);showToast(`ارسال پیام ناموفق بود: ${error.message||"خطا"}`);}
    finally{button.disabled=false;input.focus();}
  });
  $("#attachImageBtn").addEventListener("click", () => $("#chatImageInput").click());
  $("#attachVideoBtn").addEventListener("click", () => $("#chatVideoInput").click());
  $("#attachFileBtn").addEventListener("click", () => $("#chatFileInput").click());
  $("#chatImageInput").addEventListener("change", event => { const file=event.target.files?.[0]; if(file) sendChatMedia(file,"image"); event.target.value=""; });
  $("#chatVideoInput").addEventListener("change", event => { const file=event.target.files?.[0]; if(file) sendChatMedia(file,"video"); event.target.value=""; });
  $("#chatFileInput").addEventListener("change", event => { const file=event.target.files?.[0]; if(file) sendChatMedia(file,"file"); event.target.value=""; });
  $("#recordVoiceBtn").addEventListener("click", async () => {
    const button=$("#recordVoiceBtn"), status=$("#voiceRecordStatus");
    if (mediaRecorder?.state === "recording") { mediaRecorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return showToast("ضبط صدا در این مرورگر پشتیبانی نمی‌شود.");
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({audio:true});
      const mime = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type)) || "";
      mediaRecorder = new MediaRecorder(voiceStream, mime ? {mimeType:mime} : undefined);
      voiceChunks = []; recordingStartedAt = Date.now();
      mediaRecorder.ondataavailable = event => { if(event.data?.size) voiceChunks.push(event.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(voiceChunks, {type:mediaRecorder.mimeType || "audio/webm"});
        voiceStream?.getTracks().forEach(track=>track.stop()); voiceStream=null;
        status.hidden=true; button.classList.remove("recording"); button.textContent="🎙";
        if (blob.size && Date.now()-recordingStartedAt > 500) {
          const ext = blob.type.includes("ogg") ? "ogg" : "webm";
          await sendChatMedia(new File([blob], `voice-${Date.now()}.${ext}`, {type:blob.type}),"audio");
        }
      };
      mediaRecorder.start(); button.classList.add("recording"); button.textContent="■"; status.hidden=false;
    } catch(error) { console.error(error); voiceStream?.getTracks().forEach(track=>track.stop()); voiceStream=null; showToast("دسترسی به میکروفون داده نشد."); }
  });
  $("#refreshInbox").addEventListener("click",loadInbox);

  // ---------------- SOCIAL GRAPH + NOTIFICATIONS ----------------
  function initials(name = "کاربر") { return String(name).trim().slice(0, 1).toUpperCase(); }
  function notificationText(item) {
    const actor = item.actor?.display_name || item.actor?.username || "یک کاربر";
    if (item.type === "follow") return `<b>${escapeHTML(actor)}</b> تو را دنبال کرد.`;
    if (item.type === "like") return `<b>${escapeHTML(actor)}</b> پستت را پسندید.`;
    if (item.type === "comment") return `<b>${escapeHTML(actor)}</b> برای پستت دیدگاه گذاشت.`;
    return `<b>${escapeHTML(actor)}</b> با تو تعامل داشت.`;
  }
  function updateNotificationBadge(count) {
    unreadNotifications = count;
    const dot = $(".notification-dot");
    if (dot) {
      dot.hidden = count < 1;
      dot.title = count ? `${persianNumber(count)} اعلان خوانده‌نشده` : "";
    }
    const nav = $('[data-view="notifications"] .nav-icon');
    if (nav) nav.dataset.unread = count ? String(count) : "";
  }
  async function loadFollowStats() {
    if (!activeUser || !window.CYRUS_DB_READY) return;
    const db = window.cyrusSupabase;
    const [followers, following] = await Promise.all([
      db.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", activeUser.id),
      db.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", activeUser.id)
    ]);
    if (followers.error) throw followers.error;
    if (following.error) throw following.error;
    const followerCount = followers.count || 0;
    const followingCount = following.count || 0;
    ["#summaryFollowerCount", "#profileFollowerCount"].forEach(sel => { if ($(sel)) $(sel).textContent = persianNumber(followerCount); });
    ["#summaryFollowingCount", "#profileFollowingCount"].forEach(sel => { if ($(sel)) $(sel).textContent = persianNumber(followingCount); });
    if ($("#summaryPostCount")) $("#summaryPostCount").textContent = persianNumber(posts.filter(p => p.userId === activeUser.id).length);
  }
  async function loadPeople(target = $("#suggestionsList"), limit = 6) {
    if (!target || !activeUser || !window.CYRUS_DB_READY) return;
    target.innerHTML = '<div class="feature-empty">در حال بارگذاری کاربران...</div>';
    try {
      const db = window.cyrusSupabase;
      const [{ data: people, error }, { data: relations, error: followError }] = await Promise.all([
        db.from("profiles").select("id,username,display_name,avatar_url,bio").neq("id", activeUser.id).order("created_at", { ascending: false }).limit(40),
        db.from("follows").select("following_id").eq("follower_id", activeUser.id)
      ]);
      if (error) throw error;
      if (followError) throw followError;
      const followingIds = new Set((relations || []).map(row => row.following_id));
      const list = (people || []).slice(0, limit);
      if (!list.length) { target.innerHTML = '<div class="feature-empty">هنوز کاربر دیگری برای نمایش وجود ندارد. دوستانت را دعوت کن!</div>'; return; }
      target.innerHTML = list.map(person => {
        const name = escapeHTML(person.display_name || person.username || "کاربر سایرس");
        const username = escapeHTML(person.username || "user");
        const avatar = escapeHTML(person.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=211638&color=fff`);
        const following = followingIds.has(person.id);
        return `<article class="person-card"><button class="person-open" type="button" data-open-profile="${person.id}"><img src="${avatar}" alt=""><span class="person-copy"><b>${name}</b><span>@${username}</span><small>${escapeHTML(person.bio || "عضو جامعه Social Cyrus")}</small></span></button><button class="follow-button ${following ? "following" : ""}" data-follow-user="${person.id}" data-following="${following}">${following ? "دنبال می‌کنی" : "دنبال کردن"}</button></article>`;
      }).join("");
    } catch (error) {
      console.error("People load failed:", error);
      target.innerHTML = '<div class="feature-empty">دریافت کاربران ناموفق بود؛ اجرای SQL جدید را بررسی کن.</div>';
    }
  }
  async function toggleFollow(button) {
    if (!activeUser) return showToast("برای دنبال‌کردن کاربران وارد حساب شو.");
    const targetId = button.dataset.followUser;
    if (!targetId || targetId === activeUser.id) return;
    const wasFollowing = button.dataset.following === "true";
    button.disabled = true;
    try {
      if (wasFollowing) {
        const { error } = await window.cyrusSupabase.from("follows").delete().eq("follower_id", activeUser.id).eq("following_id", targetId);
        if (error) throw error;
        button.dataset.following = "false";
        button.classList.remove("following");
        button.textContent = "دنبال کردن";
        showToast("دنبال‌کردن لغو شد.");
      } else {
        const { error } = await window.cyrusSupabase.from("follows").insert({ follower_id: activeUser.id, following_id: targetId });
        if (error && error.code !== "23505") throw error;
        button.dataset.following = "true";
        button.classList.add("following");
        button.textContent = "دنبال می‌کنی";
        showToast("کاربر با موفقیت دنبال شد.");
      }
      await loadFollowStats();
      if (viewedProfileId === targetId) {
        const { count, error: countError } = await window.cyrusSupabase.from("follows")
          .select("follower_id", { count: "exact", head: true }).eq("following_id", targetId);
        if (!countError) $("#publicFollowerCount").textContent = persianNumber(count || 0);
      }
    } catch (error) {
      console.error("Follow update failed:", error);
      showToast(`عملیات دنبال‌کردن ناموفق بود: ${error.message || "خطا"}`);
    } finally { button.disabled = false; }
  }
  async function loadNotifications() {
    const target = $("#notificationsList");
    if (!target || !activeUser || !window.CYRUS_DB_READY) return;
    target.innerHTML = '<div class="feature-empty">در حال دریافت اعلان‌ها...</div>';
    try {
      const { data, error } = await window.cyrusSupabase.from("notifications")
        .select("id,type,post_id,read_at,created_at,actor:profiles!notifications_actor_id_fkey(id,username,display_name,avatar_url)")
        .eq("recipient_id", activeUser.id).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      const items = data || [];
      updateNotificationBadge(items.filter(item => !item.read_at).length);
      if (!items.length) { target.innerHTML = '<div class="feature-empty">هنوز اعلانی نداری؛ وقتی کسی تو را دنبال کند یا با پستت تعامل داشته باشد، اینجا می‌بینی.</div>'; return; }
      target.innerHTML = items.map(item => {
        const avatar = escapeHTML(item.actor?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(item.actor?.display_name || "C")}&background=211638&color=fff`);
        const date = new Date(item.created_at).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
        return `<article class="notification-item ${item.read_at ? "read" : "unread"}" data-notification-id="${item.id}"><img src="${avatar}" alt=""><div class="notification-copy"><p>${notificationText(item)}</p><time>${date}</time></div>${item.read_at ? "" : '<i class="unread-mark"></i>'}</article>`;
      }).join("");
    } catch (error) {
      console.error("Notifications load failed:", error);
      target.innerHTML = '<div class="feature-empty">دریافت اعلان‌ها ناموفق بود؛ SQL مرحله جدید را اجرا کن.</div>';
    }
  }
  async function markNotificationsRead(ids = null) {
    if (!activeUser) return;
    let query = window.cyrusSupabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", activeUser.id).is("read_at", null);
    if (ids?.length) query = query.in("id", ids);
    const { error } = await query;
    if (error) { console.error(error); return showToast("علامت‌گذاری اعلان‌ها ناموفق بود."); }
    await loadNotifications();
  }
  async function initializeSocialFeatures() {
    if (!activeUser || !window.CYRUS_DB_READY) return;
    await Promise.all([loadPeople(), loadFollowStats(), loadNotifications()]);
    if (socialRealtimeChannel) window.cyrusSupabase.removeChannel(socialRealtimeChannel);
    socialRealtimeChannel = window.cyrusSupabase.channel(`cyrus-social-${activeUser.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${activeUser.id}` }, payload => {
        showToast("اعلان جدید داری.");
        loadNotifications();
      })
      .subscribe();
  }

  async function handlePostAction(event) {
    const menuToggle = event.target.closest("[data-post-menu-toggle]");
    if (menuToggle) {
      const wrap = menuToggle.closest(".post-menu-wrap");
      const menu = $("[data-post-menu]", wrap);
      const willOpen = menu.hidden;
      $$("[data-post-menu]").forEach(item => { item.hidden = true; item.closest(".post-menu-wrap")?.querySelector("[data-post-menu-toggle]")?.setAttribute("aria-expanded", "false"); });
      menu.hidden = !willOpen;
      menuToggle.setAttribute("aria-expanded", String(willOpen));
      event.stopPropagation();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const card = button.closest(".post-card");
    const post = posts.find(item => item.id === card?.dataset.id) || viewedProfilePosts.find(item => item.id === card?.dataset.id);
    if (!post) return;
    const action = button.dataset.action;
    if (action === "edit-post") {
      if (post.userId !== activeUser?.id) return showToast("اجازه ویرایش این پست را نداری.");
      $$("[data-post-menu]").forEach(item => item.hidden = true);
      openEditPost(post);
    } else if (action === "delete-post") {
      if (post.userId !== activeUser?.id) return showToast("اجازه حذف این پست را نداری.");
      $$("[data-post-menu]").forEach(item => item.hidden = true);
      if (!window.confirm("از حذف این پست مطمئنی؟ این کار قابل بازگشت نیست.")) return;
      button.disabled = true;
      try {
        const { error } = await window.cyrusSupabase.from("posts").delete().eq("id", post.id).eq("user_id", activeUser.id);
        if (error) throw error;
        posts = posts.filter(item => item.id !== post.id);
        viewedProfilePosts = viewedProfilePosts.filter(item => item.id !== post.id);
        renderPosts();
        if (!$("#profilePage").hidden) renderProfilePosts();
        if (!$("#publicProfilePage").hidden) renderPosts(viewedProfilePosts, $("#publicProfilePosts"));
        showToast("پست با موفقیت حذف شد.");
      } catch (error) {
        console.error("Post delete failed:", error);
        showToast(`حذف پست ناموفق بود: ${error.message || "خطا"}`);
        button.disabled = false;
      }
    } else if (action === "like") {
      if (!activeUser) return showToast("برای پسندیدن پست وارد حساب شو.");
      button.disabled = true;
      try {
        if (post.liked) {
          const { error } = await window.cyrusSupabase.from("likes").delete().eq("post_id", post.id).eq("user_id", activeUser.id);
          if (error) throw error;
          post.liked = false;
          post.likes = Math.max(0, post.likes - 1);
        } else {
          const { error } = await window.cyrusSupabase.from("likes").insert({ post_id: post.id, user_id: activeUser.id });
          if (error && error.code !== "23505") throw error;
          post.liked = true;
          post.likes += 1;
        }
        renderPosts();
        if (!$("#profilePage").hidden) renderProfilePosts();
      if (!$("#publicProfilePage").hidden) renderPosts(viewedProfilePosts, $("#publicProfilePosts"));
        if (!$("#publicProfilePage").hidden) renderPosts(viewedProfilePosts, $("#publicProfilePosts"));
      } catch (error) {
        console.error("Like update failed:", error);
        showToast(`ثبت پسند ناموفق بود: ${error.message || "خطا"}`);
        button.disabled = false;
      }
    } else if (action === "save") {
      post.saved = !post.saved;
      renderPosts();
      if (!$("#profilePage").hidden) renderProfilePosts();
      if (!$("#publicProfilePage").hidden) renderPosts(viewedProfilePosts, $("#publicProfilePosts"));
      showToast(post.saved ? "به ذخیره‌شده‌ها اضافه شد." : "از ذخیره‌شده‌ها حذف شد.");
    } else if (action === "comment") {
      const panel = $("[data-comments]", card);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) await loadComments(post.id, panel);
    } else if (action === "share") {
      const shareText = `${post.name}: ${post.text}`;
      if (navigator.share) navigator.share({title:"Social Cyrus",text:shareText}).catch(()=>{});
      else if (navigator.clipboard) navigator.clipboard.writeText(shareText).then(()=>showToast("متن پست کپی شد."));
      else showToast("اشتراک‌گذاری در این مرورگر در دسترس نیست.");
    }
  }

  function handleCommentSubmit(event) {
    const form = event.target.closest("[data-comment-form]");
    if (!form) return;
    event.preventDefault();
    const card = form.closest(".post-card");
    if (card) submitComment(form, card.dataset.id);
  }
  document.addEventListener("click", async event => {
    const toggle = event.target.closest("[data-comment-menu-toggle]");
    if (toggle) {
      const wrap = toggle.closest(".comment-menu-wrap");
      const menu = $("[data-comment-menu]", wrap);
      const open = menu.hidden;
      $$('[data-comment-menu]').forEach(m => { m.hidden = true; m.closest(".comment-menu-wrap")?.querySelector("[data-comment-menu-toggle]")?.setAttribute("aria-expanded", "false"); });
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      event.stopPropagation();
      return;
    }
    const actionButton = event.target.closest("[data-comment-action]");
    if (!actionButton) {
      if (!event.target.closest(".comment-menu-wrap")) $$('[data-comment-menu]').forEach(m => m.hidden = true);
      return;
    }
    const item = actionButton.closest(".comment-item");
    const card = actionButton.closest(".post-card");
    const commentId = item?.dataset.commentId;
    const isMine = item?.dataset.commentUser === activeUser?.id;
    const isPostOwner = card?.dataset.ownerId === activeUser?.id;
    const action = actionButton.dataset.commentAction;
    if (!activeUser || (!isMine && !isPostOwner) || (action === "edit" && !isMine)) return showToast("اجازه انجام این کار را نداری.");
    $$('[data-comment-menu]').forEach(m => m.hidden = true);
    if (action === "edit") {
      const bodyNode = $("[data-comment-body]", item);
      const oldBody = bodyNode.textContent;
      const nextBody = window.prompt("متن جدید دیدگاه:", oldBody);
      if (nextBody === null) return;
      const body = nextBody.trim();
      if (!body || body.length > 1000) return showToast("متن دیدگاه باید بین ۱ تا ۱۰۰۰ کاراکتر باشد.");
      actionButton.disabled = true;
      const { error } = await window.cyrusSupabase.from("comments").update({ body }).eq("id", commentId).eq("user_id", activeUser.id);
      if (error) { showToast(`ویرایش ناموفق بود: ${error.message}`); actionButton.disabled = false; return; }
      bodyNode.textContent = body;
      showToast("دیدگاه ویرایش شد.");
    } else if (action === "delete") {
      if (!window.confirm("از حذف این دیدگاه مطمئنی؟")) return;
      actionButton.disabled = true;
      const { error } = await window.cyrusSupabase.from("comments").delete().eq("id", commentId);
      if (error) { showToast(`حذف ناموفق بود: ${error.message}`); actionButton.disabled = false; return; }
      const postId = card.dataset.id;
      const post = posts.find(p => p.id === postId) || viewedProfilePosts.find(p => p.id === postId);
      if (post) post.comments = Math.max(0, (post.comments || 0) - 1);
      item.remove();
      const list = $(".comments-list", card);
      if (!list.querySelector(".comment-item")) list.innerHTML = '<p class="comment-empty">هنوز دیدگاهی ثبت نشده.</p>';
      const countLabel = card.querySelector('[data-action="comment"] span:last-child');
      if (countLabel && post) countLabel.textContent = `${persianNumber(post.comments)} دیدگاه`;
      showToast("دیدگاه حذف شد.");
    }
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".post-menu-wrap")) {
      $$("[data-post-menu]").forEach(item => { item.hidden = true; item.closest(".post-menu-wrap")?.querySelector("[data-post-menu-toggle]")?.setAttribute("aria-expanded", "false"); });
    }
  });
  postsContainer.addEventListener("click", handlePostAction);
  $("#profilePosts").addEventListener("click", handlePostAction);
  postsContainer.addEventListener("submit", handleCommentSubmit);
  $("#profilePosts").addEventListener("submit", handleCommentSubmit);

  document.addEventListener("click", event => {
    const profileLink = event.target.closest("[data-open-profile]");
    if (profileLink) { event.preventDefault(); openPublicProfile(profileLink.dataset.openProfile); return; }
    const follow = event.target.closest("[data-follow-user]");
    if (follow) { toggleFollow(follow); return; }
    const nav = event.target.closest("[data-view]");
    if (nav) {
      const view = nav.dataset.view;
      $$(".nav-item,.mobile-nav button").forEach(item => item.classList.toggle("active", item.dataset.view === view));
      const titles = {home:"خانه",explore:"اکسپلور",messages:"پیام‌ها",notifications:"اعلان‌ها",saved:"ذخیره‌شده‌ها",profile:"پروفایل من",settings:"تنظیمات"};
      $("#pageTitle").textContent = titles[view] || "خانه";
      hideMainViews();
      if (view === "home") { $(".content-grid").hidden = false; showToast("به خانه برگشتی."); }
      else if (view === "profile") { $("#profilePage").hidden = false; renderProfilePosts(); loadFollowStats().catch(console.error); }
      else if (view === "explore") { $("#explorePage").hidden = false; loadPeople($("#explorePeople"), 40); }
      else if (view === "notifications") { $("#notificationsPage").hidden = false; loadNotifications(); }
      else if (view === "messages") { $("#messagesPage").hidden = false; $("#pageTitle").textContent="پیام‌ها"; loadInbox(); }
      else if (view === "saved") { $(".content-grid").hidden = false; showToast("بخش ذخیره‌شده‌ها در مرحله بعد تکمیل می‌شود."); }
      else if (view === "settings") { $(".content-grid").hidden = false; showToast("تنظیمات در مرحله بعد اضافه می‌شود."); }
    }
  });

  let activeProfileTab = "posts";
  function renderProfilePosts() {
    const mine = posts.filter(post => post.userId === activeUser?.id);
    $("#myPostCount").textContent = persianNumber(mine.length);
    $("#tabPostCount").textContent = persianNumber(mine.length);
    if ($("#summaryPostCount")) $("#summaryPostCount").textContent = persianNumber(mine.length);
    let visible = mine;
    if (activeProfileTab === "media") visible = mine.filter(post => !!post.image);
    if (activeProfileTab === "saved") visible = posts.filter(post => post.saved);
    renderPosts(visible, $("#profilePosts"));
  }
  $("#profilePage").addEventListener("click", event => {
    const tab = event.target.closest("[data-profile-tab]");
    if (tab) {
      activeProfileTab = tab.dataset.profileTab;
      $$(".profile-tab").forEach(item => item.classList.toggle("active", item === tab));
      renderProfilePosts();
    }
  });
  $("#profileNewPost").addEventListener("click", openModal);
  $("#editProfileBtn").addEventListener("click", openEditProfile);
  $("#closeEditProfile").addEventListener("click", closeEditProfile);
  $("#editProfileModal").addEventListener("click", event => { if (event.target.id === "editProfileModal") closeEditProfile(); });
  $("#editBio").addEventListener("input", event => {
    $("#bioCharCount").textContent = `${persianNumber(event.target.value.length)} / ۱۶۰`;
  });
  $("#profileImageInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("لطفاً یک فایل تصویری انتخاب کن."); return; }
    if (file.size > 8 * 1024 * 1024) { showToast("حجم عکس باید کمتر از ۸ مگابایت باشد."); event.target.value = ""; return; }
    try {
      const resized = await resizeProfileImage(file);
      $("#editAvatarPreview").src = resized;
      $("#editAvatarPreview").dataset.pendingImage = resized;
    } catch (error) { console.error(error); showToast("خواندن تصویر ناموفق بود."); }
  });
  $("#saveProfileBtn").addEventListener("click", async () => {
    const name = $("#editDisplayName").value.trim();
    const bio = $("#editBio").value.trim();
    if (name.length < 2) { showToast("نام باید حداقل ۲ حرف داشته باشد."); return; }
    const button = $("#saveProfileBtn");
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "در حال ذخیره...";
    try {
      if (!window.CYRUS_DB_READY) {
        showToast("ابتدا آدرس و کلید Supabase را در js/config.js وارد کن.");
        return;
      }
      const user = await getSignedInUser();
      if (!user) {
        showToast("برای ذخیره آنلاین، ابتدا وارد حساب Supabase شو.");
        return;
      }
      let avatarUrl = userProfile.avatar;
      const pendingImage = $("#editAvatarPreview").dataset.pendingImage;
      if (pendingImage) avatarUrl = await uploadProfileAvatar(user, pendingImage);
      const profileRow = {
        id: user.id,
        username: userProfile.username || usernameFromUser(user),
        display_name: name,
        bio,
        avatar_url: avatarUrl
      };
      const { error } = await window.cyrusSupabase
        .from("profiles").upsert(profileRow, { onConflict: "id" });
      if (error) throw error;
      userProfile = { name, bio, avatar: avatarUrl, username: profileRow.username };
      applyProfile();
      renderPosts();
      renderProfilePosts();
      closeEditProfile();
      $("#profileImageInput").value = "";
      delete $("#editAvatarPreview").dataset.pendingImage;
      showToast("پروفایل با موفقیت در Supabase ذخیره شد.");
    } catch (error) {
      console.error("Supabase profile save failed:", error);
      const message = error?.message || "خطای نامشخص";
      showToast(message.includes("Bucket not found") ? "Storage bucket با نام profile-avatars ساخته نشده است." : "ذخیره پروفایل ناموفق بود؛ SQL و دسترسی‌های Supabase را بررسی کن.");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  });

  $("#shareProfileBtn").addEventListener("click", () => {
    const url = location.href.split("#")[0] + "#profile";
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => showToast("لینک پروفایل کپی شد."));
    else showToast("آدرس پروفایل: " + url);
  });

    $("#searchInput").addEventListener("input", event => {
    const query = event.target.value.trim().toLocaleLowerCase("fa");
    const filtered = posts.filter(post => `${post.name} ${post.handle} ${post.text}`.toLocaleLowerCase("fa").includes(query));
    renderPosts(filtered);
  });
  $("#refreshSuggestions").addEventListener("click", () => loadPeople($("#suggestionsList"), 6));
  $("#addImageBtn").addEventListener("click", openModal);
  $("#addFeelingBtn").addEventListener("click", () => { openModal(); textarea.value += "امروز حس خوبی دارم ✨"; textarea.dispatchEvent(new Event("input")); });
  $("#feedFilter").addEventListener("click", () => showToast("مرتب‌سازی فید در مرحله بعد اضافه می‌شود."));

  $("#refreshExplore").addEventListener("click", () => loadPeople($("#explorePeople"), 40));
  $("#refreshSuggestions").addEventListener("click", () => loadPeople($("#suggestionsList"), 6));
  $("#markAllNotifications").addEventListener("click", () => markNotificationsRead());
  $("#notificationsList").addEventListener("click", event => {
    const item = event.target.closest("[data-notification-id]");
    if (item && item.classList.contains("unread")) markNotificationsRead([item.dataset.notificationId]);
  });

  if (window.CYRUS_DB_READY) {
    console.info("Supabase client initialized; profile data is synchronized with public.profiles.");
  } else {
    console.info("Supabase is not configured. Add Project URL and anon/publishable key in js/config.js.");
  }
  applyProfile();
  renderPosts();
  initializeAuth();
  if (location.hash === "#profile") {
    const profileNav = document.querySelector('[data-view="profile"]');
    if (profileNav) profileNav.click();
  }
})();
