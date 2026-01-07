import { SVGProps } from "react";

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

// 用户管理相关类型
export interface User {
  id: number;
  name?: string;
  user: string;
  pwd?: string;
  status: number;
  flow: number;
  num: number;
  expTime?: number;
  flowResetTime?: number;
  createdTime?: number;
  inFlow?: number;
  outFlow?: number;
  allowNodeCreate?: number;
  speedId?: number | null;
}

export interface UserForm {
  id?: number;
  name?: string;
  user: string;
  pwd?: string;
  status: number;
  flow: number;
  num: number;
  expTime: Date | null;
  flowResetTime: number;
  allowNodeCreate: number;
  speedId: number | null;
}

export interface UserNode {
  id: number;
  userId: number;
  nodeId: number;
  accessType: number;
  nodeName: string;
  ip: string;
  serverIp: string;
}

export interface UserNodeForm {
  nodeId: number | null;
  accessType: number;
}

export interface Node {
  id: number;
  name: string;
  ip: string;
  serverIp: string;
  portSta?: number;
  portEnd?: number;
  outPort?: number;
  status?: number;
  trafficRatio?: number;
  accessType?: number;
}

export interface Tunnel {
  id: number;
  name: string;
  inNodeId?: number;
  inNodeIds?: string;
  outNodeId?: number;
  outNodeIds?: string;
  inIp?: string;
  outIp?: string;
  outStrategy?: string;
  status?: number;
  type?: number;
  muxEnabled?: boolean;
}

export interface SpeedLimit {
  id: number;
  name: string;
  speed: number;
}

export interface Pagination {
  current: number;
  size: number;
  total: number;
}
