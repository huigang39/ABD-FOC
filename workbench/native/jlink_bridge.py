#!/usr/bin/env python3
"""Private JSON-lines bridge to the locally installed SEGGER DLL (no pip dependency).

ABI declarations follow the J-Link SDK and Square's public pylink wrapper:
https://github.com/square/pylink/blob/master/pylink/structs.py
https://kb.segger.com/J-Link_Command_Strings
No target reset, halt, resume or motor command is exposed by this bridge.
"""
import base64
import ctypes as C
import json
import os
import struct
import sys

DEVICE = 'STM32H745II_M7'
RAM = [(0x20000000, 0x20000), (0x24000000, 0x80000), (0x30000000, 0x48000), (0x38000000, 0x10000), (0x38800000, 0x1000)]

class Probe(C.Structure):
    _fields_ = [('serial', C.c_uint32), ('connection', C.c_ubyte), ('usb', C.c_uint32),
                ('ip', C.c_uint8 * 16), ('time', C.c_int), ('time_us', C.c_uint64),
                ('hardware', C.c_uint32), ('mac', C.c_uint8 * 6), ('product', C.c_char * 32),
                ('nickname', C.c_char * 32), ('firmware', C.c_char * 112),
                ('dhcp', C.c_char), ('dhcp_valid', C.c_char), ('connections', C.c_char),
                ('connections_valid', C.c_char), ('padding', C.c_uint8 * 34)]

def valid_ram(address, size):
    return isinstance(address, int) and isinstance(size, int) and 0 < size <= 4096 and any(start <= address and address + size <= start + length for start, length in RAM)

class Bridge:
    def __init__(self, library):
        self.library = library
        self.dll = C.CDLL(library)
        self.connected = False
        self.trace = None
        self.serial = None
        declarations = {
            'JLINKARM_Open': (C.c_char_p, []), 'JLINKARM_Close': (None, []),
            'JLINKARM_GetDLLVersion': (C.c_int, []),
            'JLINKARM_DEVICE_GetIndex': (C.c_int, [C.c_char_p]),
            'JLINKARM_EMU_GetList': (C.c_int, [C.c_int, C.POINTER(Probe), C.c_int]),
            'JLINKARM_EMU_SelectByUSBSN': (C.c_int, [C.c_uint32]),
            'JLINKARM_ExecCommand': (C.c_int, [C.c_char_p, C.c_void_p, C.c_int]),
            'JLINKARM_TIF_Select': (C.c_int, [C.c_int]),
            'JLINKARM_SetSpeed': (None, [C.c_uint32]), 'JLINKARM_Connect': (C.c_int, []),
            'JLINKARM_IsConnected': (C.c_int, []), 'JLINKARM_IsHalted': (C.c_int, []),
            'JLINKARM_GetSN': (C.c_uint32, []),
            'JLINKARM_ReadMemEx': (C.c_int, [C.c_uint32, C.c_uint32, C.c_void_p, C.c_uint32]),
            'JLINKARM_WriteMem': (C.c_int, [C.c_uint32, C.c_uint32, C.c_void_p]),
        }
        for name, (result, args) in declarations.items():
            fn = getattr(self.dll, name); fn.restype = result; fn.argtypes = args

    def command(self, value):
        result = C.create_string_buffer(1024)
        rc = self.dll.JLINKARM_ExecCommand(value.encode('ascii'), result, len(result))
        if rc < 0 or result.value:
            raise RuntimeError(result.value.decode(errors='replace') or f'J-Link command failed: {value}')

    def probe(self):
        devices = (Probe * 64)()
        count = self.dll.JLINKARM_EMU_GetList(1, devices, len(devices))  # USB only; no network scan.
        if count < 0: raise RuntimeError('J-Link USB 枚举失败。')
        return {'available': True, 'library': self.library, 'dllVersion': self.dll.JLINKARM_GetDLLVersion(),
                'device': DEVICE, 'deviceSupported': self.dll.JLINKARM_DEVICE_GetIndex(DEVICE.encode()) >= 0,
                'probes': [{'serialNumber': p.serial, 'product': p.product.decode(errors='replace')} for p in devices[:min(count, len(devices))]]}

    def disconnect(self):
        self.dll.JLINKARM_Close()
        self.connected = False; self.trace = None; self.serial = None
        return {'connected': False}

    def connect(self, args):
        if self.connected: raise RuntimeError('请先断开当前 J-Link。')
        devices = self.probe()
        if not devices['deviceSupported']: raise RuntimeError('当前 J-Link 软件不支持 STM32H745II_M7。')
        serial = args.get('serialNumber')
        if serial is None:
            if len(devices['probes']) != 1: raise RuntimeError('未发现唯一 J-Link，请连接探针或指定已枚举序列号。')
            serial = devices['probes'][0]['serialNumber']
        if serial not in [p['serialNumber'] for p in devices['probes']]: raise RuntimeError('指定 J-Link 不在 USB 枚举列表中。')
        speed = args.get('speedKHz', 4000)
        if type(speed) is not int or not 5 <= speed <= 50000: raise ValueError('SWD 速度必须为 5–50000 kHz。')
        self.command('SuppressGUI = 1')
        if self.dll.JLINKARM_EMU_SelectByUSBSN(serial) < 0: raise RuntimeError('无法选择 J-Link。')
        error = self.dll.JLINKARM_Open()
        if error: raise RuntimeError(error.decode(errors='replace'))
        try:
            # Reject fallback under-reset connects and preserve execution on disconnect.
            for command in ('InhibitConnectRetries = 1', 'ForceAttachTarget = 1', 'SetRestartOnClose = 0'):
                self.command(command)
            if self.dll.JLINKARM_TIF_Select(1) < 0: raise RuntimeError('无法选择 SWD。')
            self.dll.JLINKARM_SetSpeed(speed)
            self.command('Device = ' + DEVICE)
            if not self.dll.JLINKARM_IsConnected() and self.dll.JLINKARM_Connect() < 0: raise RuntimeError('连接 M7 失败；未执行复位重试。')
            self.connected = True; self.serial = self.dll.JLINKARM_GetSN()
            return self.status()
        except Exception:
            self.disconnect()
            raise

    def status(self):
        if self.connected and not self.dll.JLINKARM_IsConnected():
            self.disconnect()
        return {'connected': self.connected, 'device': DEVICE, 'serialNumber': self.serial,
                'halted': bool(self.dll.JLINKARM_IsHalted()) if self.connected else None}

    def read(self, address, size):
        if not self.connected: raise RuntimeError('J-Link 尚未连接。')
        if not valid_ram(address, size): raise ValueError('读取地址不属于 neo75H 允许的 RAM 区域。')
        data = C.create_string_buffer(size)
        count = self.dll.JLINKARM_ReadMemEx(address, size, data, 0)
        if count != size: raise RuntimeError(f'RAM 读取不完整：{count}/{size} bytes。')
        return data.raw

    def dispatch(self, method, args):
        if method == 'probe': return self.probe()
        if method == 'connect': return self.connect(args)
        if method == 'disconnect': return self.disconnect()
        if method == 'status': return self.status()
        if method == 'read': return {'data': base64.b64encode(self.read(args['address'], args['size'])).decode()}
        if method == 'authorizeTrace':
            address = args['address']
            if address % 4: raise ValueError('控制区地址必须 4 字节对齐。')
            data = self.read(address, 688)
            if struct.unpack_from('<II', data) != (0x05545243, 688): raise ValueError('控制区 ABI 不匹配，拒绝写入。')
            self.trace = address
            return {'authorized': True}
        if method == 'write':
            data = base64.b64decode(args['data'], validate=True); address = args['address']
            if self.trace is None or (address, len(data)) not in [(self.trace + 8, 4), (self.trace + 16, 136)]:
                raise ValueError('仅允许写入已校验 trace 控制区的配置与提交序号。')
            if not self.connected: raise RuntimeError('J-Link 尚未连接。')
            buffer = C.create_string_buffer(data)
            count = self.dll.JLINKARM_WriteMem(address, len(data), buffer)
            if count != len(data): raise RuntimeError(f'采样配置写入不完整：{count}/{len(data)} bytes。')
            return {'written': count}
        raise ValueError('不支持的调试请求。')

def main():
    # Vendor library console output cannot contaminate the JSON channel.
    output = os.fdopen(os.dup(sys.stdout.fileno()), 'w', buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    bridge = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if bridge is None: bridge = Bridge(sys.argv[1])
            result = bridge.dispatch(request['method'], request.get('args') or {})
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            response = {'id': request.get('id'), 'error': str(error)}
        output.write(json.dumps(response, allow_nan=False) + '\n')
    if bridge: bridge.disconnect()

if __name__ == '__main__': main()
