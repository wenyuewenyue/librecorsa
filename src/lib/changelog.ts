/** Version log shown in the game. One entry per deployment; repeated fixes
 * for the same problem are merged into a single entry. No dates, matching
 * the repo CHANGELOG.md (same versions, same wording). */

export const CURRENT_VERSION = "V2.0";

export type ChangelogKind = "新增" | "优化" | "修复";

export interface ChangelogItem {
  kind: ChangelogKind;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "V2.0",
    items: [
      { kind: "新增", text: "7 条新赛道：斯帕、银石、亚斯码头、新加坡滨海湾、蒙扎、雪邦、代托纳（椭圆、公路两种布局）" },
      { kind: "新增", text: "9 辆新赛车：SF-26、W17、RB22、SF71H、RB8、R25、F2004 共 7 辆 F1 赛车，AMG GT3 Evo、宝马 M4 GT3 Evo 共 2 辆 GT3 赛车，含各自引擎音效" },
      { kind: "优化", text: "F1 赛车改用刚体物理模型，渲染升级" },
      { kind: "优化", text: "铃鹿赛道重建，长度更新为 5846.38 米；斯帕、银石赛道文件改走云端大文件托管" },
    ],
  },
  {
    version: "V1.45",
    items: [{ kind: "新增", text: "按键显示重开快捷键，默认 H，关闭后按 H 重新打开，恢复按钮同步显示 H 显示，可在设置里重新绑定" }],
  },
  {
    version: "V1.44",
    items: [{ kind: "优化", text: "彩蛋在自动驾驶时也生效：彩虹尾烟、撞墙回赛道" }],
  },
  {
    version: "V1.43",
    items: [{ kind: "新增", text: "主菜单底部版本标识，点开查看版本日志" }],
  },
  { version: "V1.42", items: [{ kind: "优化", text: "Logo 大字加大、字距拉开，加载页和主界面标题更醒目" }] },
  {
    version: "V1.41",
    items: [{ kind: "新增", text: "游戏正式更名为 WY赛车，标题、Logo、加载页、暂停、联机分享都改名，内部代码、存档、域名不动" }],
  },
  {
    version: "V1.40",
    items: [
      { kind: "优化", text: "开源文案删除，元数据里的开源描述删掉" },
      { kind: "新增", text: "兑换码取消使用，激活后弹窗里加取消使用" },
    ],
  },
  { version: "V1.39", items: [{ kind: "优化", text: "主按钮间距加大，练习、与 AI 竞速、联机从 6px 加到 12px" }] },
  { version: "V1.38", items: [{ kind: "优化", text: "主菜单整体上移，导航和接下来面板一起贴到大标题下面" }] },
  {
    version: "V1.37",
    items: [{ kind: "新增", text: "礼盒彩蛋入口，主界面和联机房间里都能点" }],
  },
  { version: "V1.36", items: [{ kind: "修复", text: "发车灯支柱，铃鹿、上海、茂木的发车灯不再悬空，灯的位置没动" }] },
  {
    version: "V1.35",
    items: [{ kind: "优化", text: "首次进入无切换遮罩，第一次进直接是按任意键的加载画面，之后切赛道才有过渡" }],
  },
  { version: "V1.34", items: [{ kind: "修复", text: "切换遮罩先画出来再解析，画完遮罩等一帧再解析，不再冻在旧画面上" }] },
  {
    version: "V1.33",
    items: [{ kind: "优化", text: "切赛道跳过已缓存备用场景，模型已缓存时，不再重建看台、护栏这些备用场景" }],
  },
  {
    version: "V1.32",
    items: [
      { kind: "新增", text: "预载状态显示，每个赛道右边显示已预载、预载中、未预载" },
      { kind: "修复", text: "预载状态一直显示待预载的问题" },
    ],
  },
  { version: "V1.31", items: [{ kind: "新增", text: "切赛道过渡画面，切之前先盖一层“正在切换”，准备好再换" }] },
  {
    version: "V1.30",
    items: [{ kind: "优化", text: "MFD 展开时按键提示自动让位，MFD 收起后自动回来，手动隐藏的选择不动" }],
  },
  { version: "V1.29", items: [{ kind: "新增", text: "主菜单后台预载，闲置时提前准备其他赛道和车辆" }] },
  { version: "V1.28", items: [{ kind: "修复", text: "幽灵车绘制顺序，赛车线不再盖住半透明幽灵车" }] },
  {
    version: "V1.27",
    items: [{ kind: "优化", text: "赛后提示可点展开，卡片上方单独一颗小 pill，写清可提交、可保存" }],
  },
  { version: "V1.26", items: [{ kind: "优化", text: "按键提示字号放大，行、标题、按钮、宽度都放大一档" }] },
  { version: "V1.25", items: [{ kind: "优化", text: "按键提示移到右侧，不再被左上角 AI 计时塔盖住" }] },
  {
    version: "V1.24",
    items: [{ kind: "新增", text: "房间闲置自动断开，30 分钟无操作解散，29 分钟提醒，比赛中不触发" }],
  },
  {
    version: "V1.23",
    items: [{ kind: "修复", text: "Metered 免费档服务器修正，免费档用 standard 服务器，之前那个地址不通" }],
  },
  {
    version: "V1.22",
    items: [{ kind: "新增", text: "多 TURN 备用方案，编译进包的 TURN、信号现取的 TURN、玩家自填的 TURN 一起用，优先走 443" }],
  },
  { version: "V1.21", items: [{ kind: "新增", text: "自建信号中继，房间码模式走自建中继，PeerJS 只当备用" }] },
  { version: "V1.20", items: [{ kind: "修复", text: "ICE 候选排队，候选先排队，等远端就绪再发，不再丢包" }] },
  {
    version: "V1.19",
    items: [{ kind: "新增", text: "联机加入超时提示、直连状态显示，30 秒加入超时，20 秒直连超时，状态显示检查中、已连接、已失败、已断开" }],
  },
  { version: "V1.18", items: [{ kind: "优化", text: "圈速副标题，改成“排行榜与幽灵车竞速”" }] },
  { version: "V1.17", items: [{ kind: "优化", text: "圈速显示放大，面板里的圈速数字和主菜单圈速入口都放大" }] },
  {
    version: "V1.16",
    items: [{ kind: "优化", text: "按钮、输入框高亮与原版对齐，输入框高度、圆角、聚焦光晕、删除按钮悬停色统一" }],
  },
  { version: "V1.15", items: [{ kind: "修复", text: "姓名输入框高亮框，黄色聚焦框不再比输入框大" }] },
  { version: "V1.14", items: [{ kind: "新增", text: "在线记录删除，只删在线行，本地成绩不动，两步确认" }] },
  { version: "V1.13", items: [{ kind: "新增", text: "排行榜车手改名，面板里直接改名字和代码" }] },
  { version: "V1.12", items: [{ kind: "修复", text: "Worker 收尾帧校验，最后一对样本跳过，不再把正常快圈误判成超速" }] },
  { version: "V1.11", items: [{ kind: "优化", text: "排行榜改走自定义域名，不再走 workers.dev，连接更稳" }] },
  { version: "V1.10", items: [{ kind: "新增", text: "排行榜面板上传我的最佳，不用再跑一圈，也能把本地最佳传上去" }] },
  {
    version: "V1.9",
    items: [{ kind: "优化", text: "圈速上传卡片常驻，能上传的卡片不再 12 秒自动消失，点上传或关闭才走" }],
  },
  { version: "V1.8", items: [{ kind: "优化", text: "温越出品标注，主标题下标注" }] },
  { version: "V1.7", items: [{ kind: "修复", text: "排行榜双域名同步，wysaiche 也能读写同一个在线榜" }] },
  { version: "V1.6", items: [{ kind: "优化", text: "驾驶时屏蔽浏览器快捷键，减少误触打断比赛" }] },
  {
    version: "V1.5",
    items: [{ kind: "新增", text: "按键提示按设备自动切换，键盘、手柄、方向盘、触屏各显示对应按键" }],
  },
  {
    version: "V1.4",
    items: [{ kind: "优化", text: "惩罚规则，闪回免费，自动驾驶每圈 +30 秒，练习赛压线每次 +3 秒，规则按模式区分" }],
  },
  { version: "V1.3", items: [{ kind: "优化", text: "主菜单精简，去掉制作名单、申请车辆/赛道入口，标题简化" }] },
  { version: "V1.2", items: [{ kind: "新增", text: "首次启动画质检测，可跳过，设置里可重测" }] },
  { version: "V1.1", items: [{ kind: "修复", text: "转向旋钮漏抬起后，新的按下可以接管" }] },
  {
    version: "V1.0",
    items: [{ kind: "新增", text: "中文界面，卢旺达、茂木、铃鹿、上海 4 条赛道，FA-26、GT3，练习、与 AI 竞速、联机房间" }],
  },
];
