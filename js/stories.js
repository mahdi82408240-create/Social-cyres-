/* Social Cyrus Stories — Supabase-backed 24h stories */
(() => {
  const $ = (s) => document.querySelector(s);
  const db = () => window.cyrusSupabase;
  let currentUser = null;
  let stories = [];
  let selectedFile = null;
  let activeGroup = null;
  let activeIndex = 0;
  const row = $('#storiesRow');
  if (!row) return;
  const addModal = $('#storyCreateModal');
  const viewer = $('#storyViewer');
  const fileInput = $('#storyFile');
  const videoInput = $('#storyVideoFile');
  const preview = $('#storyPreview');
  const publish = $('#publishStory');
  const toast = (m) => { const t=$('#toast'); if(t){t.textContent=m;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2600);} };
  const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const avatar = (p) => p?.avatar_url || 'https://i.pravatar.cc/100?img=12';
  function open(el){el.classList.add('open');el.setAttribute('aria-hidden','false');}
  function close(el){el.classList.remove('open');el.setAttribute('aria-hidden','true');}
  function render(){
    const groups = new Map();
    for(const s of stories){const uid=s.user_id;if(!groups.has(uid))groups.set(uid,[]);groups.get(uid).push(s);}
    const own = currentUser?.id;
    let html = `<button class="story add-story" id="addStoryButton"><span class="story-ring add-ring"><b>＋</b></span><span>استوری تو</span></button>`;
    for(const [uid,list] of groups){const p=list[0].profiles||{};const mine=uid===own;html+=`<button class="story ${mine?'own-story':''}" data-story-user="${esc(uid)}"><span class="story-ring"><img src="${esc(avatar(p))}" alt=""></span><span>${mine?'استوری تو':esc(p.display_name||p.username||'کاربر')}</span></button>`;}
    row.innerHTML=html;
  }
  async function load(){
    if(!db()||!currentUser){stories=[];render();return;}
    const {data,error}=await db().from('stories').select('id,user_id,media_url,media_type,created_at,expires_at,profiles!stories_user_id_fkey(id,username,display_name,avatar_url)').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:true});
    if(error){console.error('Stories load:',error);toast('دریافت استوری‌ها ناموفق بود. Migration را بررسی کن.');return;}
    stories=data||[];render();
  }
  function previewFile(file){selectedFile=file;preview.innerHTML='';if(!file)return;const url=URL.createObjectURL(file);preview.innerHTML=file.type.startsWith('video/')?`<video src="${url}" controls muted></video>`:`<img src="${url}" alt="پیش‌نمایش استوری">`;}
  function openCreate(){if(!currentUser){toast('ابتدا وارد حساب شو.');return;}fileInput.value='';preview.innerHTML='';selectedFile=null;open(addModal);}
  async function createStory(){
    if(!selectedFile||!currentUser)return toast('یک عکس یا ویدئو انتخاب کن.');
    if(!/^image\/(jpeg|png|webp|gif)$/.test(selectedFile.type)&&!/^video\/(mp4|webm|quicktime)$/.test(selectedFile.type))return toast('فرمت فایل پشتیبانی نمی‌شود. برای ویدئو از MP4، WEBM یا MOV استفاده کن.');
    const max=selectedFile.type.startsWith('video/')?50:12;if(selectedFile.size>max*1024*1024)return toast(`حجم فایل باید کمتر از ${max} مگابایت باشد.`);
    publish.disabled=true;publish.textContent='در حال انتشار...';
    try{
      const ext=(selectedFile.name.split('.').pop()|| (selectedFile.type.startsWith('video/')?'mp4':'jpg')).toLowerCase().replace(/[^a-z0-9]/g,'');
      const path=`${currentUser.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const {error:upErr}=await db().storage.from('story-media').upload(path,selectedFile,{cacheControl:'3600',upsert:false,contentType:selectedFile.type});if(upErr)throw upErr;
      const {data:urlData}=db().storage.from('story-media').getPublicUrl(path);
      const {error}=await db().from('stories').insert({user_id:currentUser.id,media_url:urlData.publicUrl,media_type:selectedFile.type.startsWith('video/')?'video':'image'});if(error){await db().storage.from('story-media').remove([path]);throw error;}
      close(addModal);await load();toast('استوری با موفقیت منتشر شد.');
    }catch(e){console.error(e);toast(e.message||'انتشار استوری ناموفق بود.');}
    finally{publish.disabled=false;publish.textContent='انتشار استوری';}
  }
  function showStory(uid){activeGroup=stories.filter(s=>s.user_id===uid);activeIndex=0;if(!activeGroup.length)return;renderViewer();open(viewer);}
  function renderViewer(){const s=activeGroup?.[activeIndex];if(!s)return;const p=s.profiles||{};const media=$('#storyViewerMedia');media.innerHTML=s.media_type==='video'?`<video src="${esc(s.media_url)}" autoplay playsinline controls></video>`:`<img src="${esc(s.media_url)}" alt="استوری">`;$('#storyViewerName').textContent=p.display_name||p.username||'کاربر';$('#storyViewerAvatar').src=avatar(p);$('#storyViewerTime').textContent=new Date(s.created_at).toLocaleString('fa-IR');$('#storyDelete').hidden=s.user_id!==currentUser?.id;$('#storyPrev').disabled=activeIndex===0;$('#storyNext').disabled=activeIndex>=activeGroup.length-1;$('#storyProgress').innerHTML=activeGroup.map((_,i)=>`<i class="${i<=activeIndex?'done':''}"></i>`).join('');}
  async function deleteStory(){const s=activeGroup?.[activeIndex];if(!s||s.user_id!==currentUser?.id)return;if(!confirm('این استوری حذف شود؟'))return;const {error}=await db().from('stories').delete().eq('id',s.id);if(error){toast('حذف استوری ناموفق بود.');return;}stories=stories.filter(x=>x.id!==s.id);close(viewer);render();toast('استوری حذف شد.');}
  row.addEventListener('click',e=>{if(e.target.closest('#addStoryButton'))openCreate();const b=e.target.closest('[data-story-user]');if(b)showStory(b.dataset.storyUser);});
  $('#allStories')?.addEventListener('click',()=>{if(stories.length)showStory(stories[0].user_id);else toast('هنوز استوری فعالی وجود ندارد.');});
  $('#closeStoryCreate')?.addEventListener('click',()=>close(addModal));$('#closeStoryViewer')?.addEventListener('click',()=>close(viewer));
  $('#pickStoryPhoto')?.addEventListener('click',()=>fileInput.click());
  $('#pickStoryVideo')?.addEventListener('click',()=>videoInput.click());
  fileInput.addEventListener('change',()=>{videoInput.value='';previewFile(fileInput.files?.[0]);});
  videoInput.addEventListener('change',()=>{fileInput.value='';previewFile(videoInput.files?.[0]);});
  publish.addEventListener('click',createStory);
  $('#storyPrev').addEventListener('click',()=>{if(activeIndex>0){activeIndex--;renderViewer();}});$('#storyNext').addEventListener('click',()=>{if(activeIndex<activeGroup.length-1){activeIndex++;renderViewer();}});$('#storyDelete').addEventListener('click',deleteStory);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){close(addModal);close(viewer);}});
  async function sync(){const {data}=await db().auth.getSession();currentUser=data.session?.user||null;await load();}
  if(db()){sync();db().auth.onAuthStateChange((_event,session)=>{currentUser=session?.user||null;setTimeout(load,0);});}
  // تازه‌سازی فهرست برای استوری‌های جدید سایر کاربران
  setInterval(()=>{if(currentUser&&!document.hidden)load();},60000);
})();
