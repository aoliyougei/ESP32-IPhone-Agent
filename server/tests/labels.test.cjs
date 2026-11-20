const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Registry IDs 156–215; names remain runtime/model-owned, not index-owned.
const expected = {
  shop_description_panel: '店铺简介信息框',
  battle_artifact_button: '战斗法宝按钮',
  battle_special_skill_button: '战斗特技按钮',
  battle_summon_button: '战斗召唤按钮',
  battle_auto_remaining_rounds: '战斗剩余自动回合数',
  didun_gui_npc: '地遁鬼',
  fotiaoqiang: '佛跳墙', kaorou: '烤肉', meihuajiu: '梅花酒',
  feicui_doufu: '翡翠豆腐', baiweijiu: '百味酒', diaohua_matong: '雕花马桶',
  caihui_huaping: '彩绘花瓶', huamu_diban: '桦木地板', menghu_zuoshan_tu: '猛虎坐山图',
  changxin_gongdeng: '长信宫灯', guihe_yannian_deng: '龟鹤延年灯', tianshan_yunxue: '天山云雪',
  xiyang_shanshui_tu: '夕阳山水图', yueya_deng: '月牙凳', mabu_ditan: '麻布地毯',
  hongmu_baxian_zhuo: '红木八仙桌', lanchou_xiuhua_lian: '蓝绸绣花帘', caihui_ligui: '彩绘立柜',
  shoupi_ditan: '兽皮地毯', qianyu_huwen_zhuo: '嵌玉虎纹桌', shizi_tu_pingfeng: '狮子图屏风',
  baihe_zhanchi_lian: '白鹤展翅帘', huaniao_tu_pingfeng: '花鸟图屏风', shenxian_zhang: '神仙帐',
  shuangyu_jiqing_gui: '双鱼吉庆柜', huamu_kaobei_yi: '桦木靠背椅', bagua_zhenxie_ta: '八卦镇邪榻',
  yuci_huaping: '玉瓷画瓶', tachun_tu: '踏春图', wenzhu: '文竹', junzilan: '君子兰',
  huamu_ligui: '桦木立柜', hudielan: '蝴蝶兰', caobian_ditan: '草编地毯', shuixian: '水仙',
  xianrenzhang: '仙人掌', heima_chuiman_lian: '黑麻垂曼帘', qihua_zhudeng: '漆花竹凳',
  yinhua_pingfeng: '印花屏风', qihua_diban: '漆花地板', dingshen_xiang: '定神香',
  kaoya: '烤鸭', chou_doufu: '臭豆腐', shedan_jiu: '蛇胆酒', guihua_wan: '桂花丸',
  zhenlu_jiu: '珍露酒', douzhai_guo: '豆斋果', zuisheng_mengsi: '醉生梦死', changshou_mian: '长寿面',
  changanjiudian_screen: '长安酒店场景屏风',
  scene_auto_away_button: '普通场景自动暂离按钮',
  scene_auto_reset_button: '普通场景自动重置按钮',
  scene_auto_cancel_button: '普通场景自动取消按钮',
  scene_auto_collapse_button: '普通场景自动折叠按钮',
};

test('all 60 appended registry labels have Chinese display names', () => {
  const source = fs.readFileSync(path.join(__dirname, '../hidagent/static/i18n.js'), 'utf8');
  const labels = vm.runInNewContext(source.split('const I18N')[0] + '\nJSON.stringify(YOLO_LABELS_ZH)',
    { document: { documentElement: { lang: 'zh' } }, localStorage: { getItem: () => null } });
  const actual = JSON.parse(labels);
  assert.equal(Object.keys(expected).length, 60);
  for (const [name, translation] of Object.entries(expected)) assert.equal(actual[name], translation, name);
  assert.equal(actual.old_shrimp_npc, '老虾');
  assert.equal(actual.battle_round_counter, '战斗回合计数');
});
