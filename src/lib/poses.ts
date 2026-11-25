import type { Dir, Figure } from "./figures";

// ポーズの一覧。向きはどれも人物から見た向き(+Z が前、+X が人物の左、+Y が上)。
// 左右は人物の左右(_l が左)。右の向きは、左の向きの X を反転したもの。

export type PoseId = "stand" | "arms_crossed" | "walk" | "run" | "sit" | "point" | "wave" | "shoulder" | "swing_up" | "swing_down";

export interface PoseDef {
  id: PoseId;
  label: string;
  /** 清書のプロンプトに使う英語 */
  en: string;
  /** 椅子(箱)の上に座る */
  seat?: boolean;
  apply: (f: Figure) => void;
}

const mirror = ([x, y, z]: Dir): Dir => [-x, y, z];

/** 腕(上腕と前腕)の向き。side の向きで書き、右は自動で反転する */
function arm(f: Figure, side: "l" | "r", upper: Dir, lower: Dir) {
  const m = side === "r" ? mirror : (d: Dir) => d;
  f.aim(`upperarm_${side}`, `lowerarm_${side}`, m(upper));
  f.aim(`lowerarm_${side}`, `hand_${side}`, m(lower));
}

/** 脚(太ももとすね)の向き */
function leg(f: Figure, side: "l" | "r", thigh: Dir, calf: Dir) {
  const m = side === "r" ? mirror : (d: Dir) => d;
  f.aim(`thigh_${side}`, `calf_${side}`, m(thigh));
  f.aim(`calf_${side}`, `foot_${side}`, m(calf));
}

/** 腕を自然に下ろす */
function armsDown(f: Figure) {
  arm(f, "l", [0.17, -1, 0.02], [0.1, -1, 0.12]);
  arm(f, "r", [0.17, -1, 0.02], [0.1, -1, 0.12]);
}

/** 脚をまっすぐ立てる */
function legsStraight(f: Figure) {
  leg(f, "l", [0.04, -1, 0], [0, -1, -0.02]);
  leg(f, "r", [0.04, -1, 0], [0, -1, -0.02]);
}

export const POSES: PoseDef[] = [
  {
    id: "stand",
    label: "立つ",
    en: "standing naturally",
    apply: (f) => {
      armsDown(f);
      legsStraight(f);
      f.curl("l", 20);
      f.curl("r", 20);
    },
  },
  {
    id: "arms_crossed",
    label: "腕を組む",
    en: "standing with arms crossed",
    apply: (f) => {
      arm(f, "l", [0.25, -1, 0.3], [-1, 0.12, 0.28]);
      arm(f, "r", [0.25, -1, 0.38], [-1, 0.2, 0.2]);
      legsStraight(f);
      f.curl("l", 45);
      f.curl("r", 45);
    },
  },
  {
    id: "walk",
    label: "歩く",
    en: "walking",
    apply: (f) => {
      arm(f, "l", [0.15, -1, -0.3], [0.1, -1, -0.1]);
      arm(f, "r", [0.15, -1, 0.3], [0.1, -1, 0.6]);
      leg(f, "l", [0.03, -1, 0.35], [0, -1, 0.05]);
      leg(f, "r", [0.03, -1, -0.3], [0, -1, -0.45]);
      f.curl("l", 30);
      f.curl("r", 30);
    },
  },
  {
    id: "run",
    label: "走る",
    en: "running",
    apply: (f) => {
      f.turn("spine_01", [1, 0, 0], 14);
      arm(f, "l", [0.12, -1, -0.7], [0, 0.5, 1]);
      arm(f, "r", [0.12, -1, 0.6], [0, 0.7, 1]);
      leg(f, "r", [0.03, -0.45, 1], [0, -1, -0.25]);
      leg(f, "l", [0.03, -1, -0.45], [0, -0.35, -1]);
      f.curl("l", 70);
      f.curl("r", 70);
    },
  },
  {
    id: "sit",
    label: "座る(椅子)",
    en: "sitting on a chair",
    seat: true,
    apply: (f) => {
      leg(f, "l", [0.12, -0.05, 1], [0, -1, 0.08]);
      leg(f, "r", [0.12, -0.05, 1], [0, -1, 0.08]);
      arm(f, "l", [0.15, -1, 0.35], [0, -0.55, 1]);
      arm(f, "r", [0.15, -1, 0.35], [0, -0.55, 1]);
      f.lower(0.24);
      f.curl("l", 25);
      f.curl("r", 25);
    },
  },
  {
    id: "point",
    label: "指差す",
    en: "pointing forward with the right hand",
    apply: (f) => {
      arm(f, "l", [0.17, -1, 0.02], [0.1, -1, 0.12]);
      arm(f, "r", [0.12, 0.12, 1], [0.02, 0.12, 1]);
      legsStraight(f);
      f.curl("l", 25);
      f.curl("r", 80);
      f.finger("r", "index", -80);
    },
  },
  {
    id: "wave",
    label: "手を振る",
    en: "waving the right hand",
    apply: (f) => {
      arm(f, "l", [0.17, -1, 0.02], [0.1, -1, 0.12]);
      arm(f, "r", [0.75, 0.35, 0.25], [0.12, 1, 0.12]);
      legsStraight(f);
      f.curl("l", 20);
    },
  },
  {
    id: "shoulder",
    label: "肩に担ぐ",
    en: "resting something on the right shoulder with the right hand",
    apply: (f) => {
      arm(f, "l", [0.17, -1, 0.02], [0.1, -1, 0.12]);
      // 肘を前に下ろし、前腕を立てて手を肩の前に置く
      arm(f, "r", [0.45, -0.7, 0.4], [0, 0.95, 0.12]);
      leg(f, "l", [0.08, -1, 0.06], [0, -1, 0]);
      leg(f, "r", [0.12, -1, -0.04], [0, -1, -0.04]);
      f.curl("l", 20);
      f.curl("r", 85);
    },
  },
  {
    id: "swing_up",
    label: "振りかぶる",
    en: "raising both hands high overhead, about to swing down",
    apply: (f) => {
      f.turn("spine_01", [1, 0, 0], -8);
      arm(f, "l", [0.2, 1, -0.25], [-0.55, 0.45, -0.5]);
      arm(f, "r", [0.2, 1, -0.25], [-0.55, 0.45, -0.5]);
      leg(f, "l", [0.12, -1, 0.18], [0, -1, 0.02]);
      leg(f, "r", [0.12, -1, -0.18], [0, -1, -0.1]);
      f.curl("l", 85);
      f.curl("r", 85);
    },
  },
  {
    id: "swing_down",
    label: "振り下ろす",
    en: "swinging both hands down forcefully",
    apply: (f) => {
      f.turn("spine_01", [1, 0, 0], 20);
      arm(f, "l", [0.12, -0.25, 1], [-0.2, -0.55, 1]);
      arm(f, "r", [0.12, -0.25, 1], [-0.2, -0.55, 1]);
      leg(f, "l", [0.08, -1, 0.5], [0, -1, 0]);
      leg(f, "r", [0.08, -1, -0.4], [0, -1, -0.5]);
      f.curl("l", 85);
      f.curl("r", 85);
    },
  },
];
