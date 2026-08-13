const progress = document.querySelector('.progress');
const heroMedia = document.querySelector('.hero-media');
const navLinks = [...document.querySelectorAll('.nav-links a')];
const sections = navLinks.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);

function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.width = `${max > 0 ? scrollY / max * 100 : 0}%`;
  if (heroMedia && scrollY < innerHeight) heroMedia.style.transform = `translateY(${scrollY * .12}px) scale(1.04)`;
  let current = '';
  sections.forEach(section => { if (scrollY >= section.offsetTop - 180) current = section.id; });
  navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${current}`));
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

const bellCopy = {
  1: ['第一钟 · 外环开放', '修道院外环搜索区开启。行动队第一次踏入废墟，学习带入、搜索、交战与撤离的基本循环。'],
  2: ['第二钟 · 黑雾蔓延', '低洼区域能见度下降，远处声响开始失真。'],
  3: ['第三钟 · 搜索加剧', '更多补给缓存被唤醒，也吸引了其他行动队与拾荒者。'],
  4: ['第四钟 · 亡灵巡逻', '亡灵巡逻密度上升，安全路线不再绝对安全。'],
  5: ['第五钟 · 地下通道开启', '封印松动，通往墓园与旧档案库的地下路线开放。'],
  6: ['第六钟 · 路线收束', '部分入口被黑雾吞没，行动队必须更早决定深入方向。'],
  7: ['第七钟 · 过去与现在重叠', '第三十七座墓短暂显现，记忆回声会重构局部区域。'],
  8: ['第八钟 · 记忆回声', '旧王都的过去侵入现实，线索与危险同时出现。'],
  9: ['第九钟 · 精英猎人刷新', '高威胁目标开始追踪携带高价值证据的玩家。'],
  10: ['第十钟 · 高阶遗物共鸣', '稀有遗物暴露位置，同时让持有者成为黑雾中的明灯。'],
  11: ['第十一钟 · 常规撤离关闭', '普通撤离点封闭，只剩契约、证据或特殊条件开启的路线。'],
  12: ['第十二钟 · 首领强化', '所有首领进入强化状态，未经认证的真相将变成沉重代价。'],
  13: ['第十三钟 · 现实覆写', '所有仍留在旧王都的行动队判定失败。本局未带出的物资、证据与选择全部失效。']
};
const bellButtons = [...document.querySelectorAll('.bell')];
const bellDetail = document.querySelector('.bell-detail');
const bellFill = document.querySelector('.bell-line-fill');
bellButtons.forEach(button => button.addEventListener('click', () => {
  const id = Number(button.dataset.bell);
  bellButtons.forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  bellFill.style.width = `${(id - 1) / 12 * 100}%`;
  bellDetail.innerHTML = `<b>${bellCopy[id][0]}</b><p>${bellCopy[id][1]}</p>`;
}));