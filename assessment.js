const questions = [
  { text: "我享受把复杂问题拆成步骤，并找到可验证的答案。", axis: "technology" },
  { text: "我愿意长时间观察数据、规律或实验现象。", axis: "technology" },
  { text: "我对人的情绪、关系和成长过程比较敏感。", axis: "people" },
  { text: "我喜欢阅读、表达、讨论观点或解释社会现象。", axis: "people" },
  { text: "我经常关注画面、空间、色彩或产品使用感受。", axis: "visualArts" },
  { text: "比起标准答案，我更享受提出视觉方案并反复打磨作品。", axis: "visualArts" },
  { text: "我愿意通过声音、动作、镜头或舞台完成表达。", axis: "performingArts" },
  { text: "我能接受反复排练、体能训练或镜头前的表达训练。", axis: "performingArts" },
  { text: "我擅长协调任务、设定目标并推动事情完成。", axis: "business" },
  { text: "我对市场、资源配置、规则和组织如何运行有兴趣。", axis: "business" },
];

const directions = {
  technology: {
    title: "工程与技术",
    description: "偏好逻辑、系统和可验证的问题，适合优先体验需要数学与实验基础的方向。",
    majors: ["计算机科学与技术", "电子信息工程", "自动化", "数学与应用数学", "软件工程"],
    subjects: "重点观察数学、物理、信息技术课程中的持续投入感。",
  },
  people: {
    title: "人文与社会",
    description: "关注人、语言与社会运行，适合从阅读、沟通和公共议题中寻找长期兴趣。",
    majors: ["法学", "汉语言文学", "心理学", "新闻学", "社会学"],
    subjects: "重点观察语文、英语、历史和社会议题写作中的优势。",
  },
  visualArts: {
    title: "美术与设计",
    description: "重视审美、画面、空间和作品完成度，适合用作品集和长期训练判断方向。",
    majors: ["美术学", "绘画", "视觉传达设计", "环境设计", "数字媒体艺术", "动画", "书法学"],
    subjects: "重点观察美术、设计基础、空间想象和作品迭代过程。",
  },
  performingArts: {
    title: "音乐舞蹈与影像",
    description: "更愿意用声音、身体、镜头或舞台表达，适合通过排练强度和专业训练体验判断方向。",
    majors: ["舞蹈表演", "舞蹈学", "音乐表演", "音乐学", "表演", "播音与主持艺术", "广播电视编导"],
    subjects: "重点观察专业统考项目、舞台表现、节奏感、镜头表达和持续训练状态。",
  },
  business: {
    title: "商业与组织",
    description: "喜欢目标、资源与协作，适合探索需要判断、沟通和定量分析的专业。",
    majors: ["经济学", "金融学", "会计学", "工商管理", "国际经济与贸易"],
    subjects: "重点观察数学、地理、政治以及组织活动中的真实表现。",
  },
};

const form = document.querySelector("#assessmentForm");
const questionList = document.querySelector("#questionList");
const result = document.querySelector("#assessmentResult");
const scale = [
  ["1", "不符合"],
  ["2", "较少"],
  ["3", "一般"],
  ["4", "较符合"],
  ["5", "很符合"],
];

function majorUrl(major) {
  return `./index.html?major=${encodeURIComponent(major)}`;
}

questionList.innerHTML = questions
  .map(
    (question, index) => `
      <fieldset class="question-card">
        <legend><span>${String(index + 1).padStart(2, "0")}</span>${question.text}</legend>
        <div class="answer-scale">
          ${scale
            .map(
              ([value, label]) => `
                <label>
                  <input type="radio" name="question-${index}" value="${value}" required />
                  <span>${label}</span>
                </label>
              `,
            )
            .join("")}
        </div>
      </fieldset>
    `,
  )
  .join("");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const scores = Object.fromEntries(Object.keys(directions).map((key) => [key, 0]));
  questions.forEach((question, index) => {
    scores[question.axis] += Number(data.get(`question-${index}`));
  });

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [primaryKey, primaryScore] = ranked[0];
  const [secondaryKey, secondaryScore] = ranked[1];
  const primary = directions[primaryKey];
  const secondary = directions[secondaryKey];
  result.hidden = false;
  result.innerHTML = `
    <div class="result-heading">
      <span>主要倾向</span>
      <h2>${primary.title}</h2>
      <p>${primary.description}</p>
    </div>
    <div class="result-direction-grid">
      <article>
        <span>${primaryScore}/10</span>
        <strong>${primary.title}</strong>
        <p>${primary.subjects}</p>
      </article>
      <article>
        <span>${secondaryScore}/10</span>
        <strong>${secondary.title}</strong>
        <p>${secondary.description}</p>
      </article>
    </div>
    <div class="major-suggestions">
      <strong>优先了解的专业</strong>
      <div>${primary.majors.map((major) => `<a href="${majorUrl(major)}">${major}</a>`).join("")}</div>
    </div>
    <a class="result-link" href="${majorUrl(primary.majors[0])}">查看${primary.majors[0]}相关院校</a>
  `;
  result.scrollIntoView({ behavior: "smooth", block: "start" });
});
