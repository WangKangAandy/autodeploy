# vllm\_musa 推理操作指导手册

# 环境信息

测试机器：mccxadmin@10.121.31.92   mccxadmin

| GPU | GPU\_core | CPU | SYSTEM | 驱动版本 | vllm 版本 | 镜像 | 驱动链接/路径 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S5000 | N/A |  | Ubuntu | 3.3.1 | 0.9.2 | registry.mthreads.com/public/vllm\_musa:20251112\_hygon |  |

## 驱动版本校验

```shell
# 查看驱动版本
dpkg -s musa

# 如果驱动版本不对：
# 卸载驱动
sudo dpkg -P musa
# 安装对应驱动包
sudo dpkg -i Path/To/xxxx.deb
# 重启加载驱动
sudo reboot
```

# 配置容器环境

*   下载模型
    

```shell
cd /data/models
# 安装模型下载工具
pip install modelscope

# 模型下载
# https://www.modelscope.cn/models 搜索获取模型地址（Qwen/Qwen3-32B 为例）
modelscope download --model Qwen/Qwen3-32B --local_dir ./Qwen/Qwen3-32B
```

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/WgZOZA8KNGa2rqLX/img/807638a2-c814-401c-928b-2c4d04609383.png)

*   起容器
    

```shell
image_name=<image_name>   # image_name 参考第一章 环境信息
docker run -itd \
  --name=vllm_musa_test \
  --env MTHREADS_VISIBLE_DEVICES=all \
  --shm-size=500g \
  --network=host \
  --privileged \
  --pid=host \
  -v /data:/data \
  $image_name bash

# 进入容器
docker exec -it vllm_musa_test bash
```

*   容器内环境验证
    

```shell
# 驱动信息
mthreads-gmi   # 失败参看 FAQ 6

# musa 环境
musaInfo       # 失败参看 FAQ 5 

# torch 环境
 python -c "import torch; print((torch.tensor([1], device='musa') + torch.tensor([2], device='musa')))"
```

# 推理测试

以 Qwen3-32B 模型为例

## 3.1 服务

### 3.1.1 单机服务

```shell
git clone https://github.com/wangkang-mt/infer_tutorial.git

cd infer_tutorial/vllm/serve
# 不区分S5000 or S4000（自动新增额定必要参数）
python vllm_serve.py /Path/to/Qwen/Qwen3-32B --served-model-name Qwen3-32B
```
> 1. python vllm\_serve.py 后接入原生 vllm serve 启动参数

> 2. 如果启动失败，参考 FAQ T4 用 vllm serve 命令行启动

### 3.1.2 多机服务

*   准备环境
    

```shell
# 1. 配置环境（两边都需要）
export VLLM_USE_RAY_COMPILED_DAG_CHANNEL_TYPE=shm
export RAY_CGRAPH_get_timeout=3000
export MCCL_PROTOS=2

# 2. 启动 ray cluster
主节点： ray start --head --port=6379 --dashboard-host='0.0.0.0' --num-gpus 8
其他节点:  ray start --address {master_node_ip}:6379 --num-gpus 8
```

*   启动服务
    
    *   S4000 机器
        
    
    ```shell
    vllm serve MODEL_PATH \
    --trust-remote-code \
    --gpu-memory-utilization 0.7 \
    --served-model-name deepseek \
    --block-size 16 \
    --tensor-parallel-size 8 \
    --pipeline-parallel-size 2 \
    --max-num-seqs 30 \
    --distributed-executor-backend ray \
    --compilation-config '{"cudagraph_capture_sizes": [1,2,3,4,5,6,7,8,10,12,14,16,18,20,24,28,30], "simple_cuda_graph": true}'
    ```
    *   S5000 机器
        

```shell
# 如果不是 DeepSeek 模型， 需要加上环境变量：
# （DeepSeek蒸馏模型也要加）
# export VLLM_USE_V1=0
vllm serve MODEL_PATH \
--trust-remote-code \
--gpu-memory-utilization 0.7 \
--served-model-name deepseek \
--block-size 64 \
--tensor-parallel-size 8 \
--pipeline-parallel-size 2 \
--max-num-seqs 30 \
--distributed-executor-backend ray \
--compilation-config '{"cudagraph_capture_sizes": [1,2,3,4,5,6,7,8,10,12,14,16,18,20,24,28,30], "simple_cuda_graph": true}'
```

### 3.1.3 发送请求

```shell
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen3-32B",
    "messages": [
      {"role": "user", "content": "你好，简单介绍一下你自己"}
    ],
    "max_tokens": 128
  }'
```

## 3.2 性能（Bench）

参考：

[https://github.com/wangkang-mt/infer\_tutorial/tree/main/vllm/bench: https://github.com/wangkang-mt/infer\_tutorial/tree/main/vllm/bench](https://github.com/wangkang-mt/infer_tutorial/tree/main/vllm/bench)

## 3.3 精度（Acc）

参考：

[https://github.com/wangkang-mt/infer\_tutorial/tree/main/vllm/acc: https://github.com/wangkang-mt/infer\_tutorial/tree/main/vllm/acc](https://github.com/wangkang-mt/infer_tutorial/tree/main/vllm/acc)

# FAQ

1.  双机推理报 GLOO 连接错误
    
    加上：
    
    ```shell
    export GLOO_SOCKET_IFNAME=bond0
    export TP_SOCKET_IFNAME=bond0
    ```
    
2.  S5000 是否使用V1 引擎：
    
    1.  DeepSeek： 用V1，去掉VLLM\_USE\_V1=0
        
    2.  其他模型：用V0，加上VLLM\_USE\_V1=0
        
3.  双机推理起服务正常，但推理报 MCCL 问题
    
    加上MCCL 相关环境变量起容器或起服务：    
    
    ```shell
    docker run -itd --name=vllm-musa --net=host --privileged -h mccx-119 -v /data:/data --env MTHREADS_VISIBLE_DEVICES=all --env VLLM_USE_RAY_COMPILED_DAG_CHANNEL_TYPE=shm --env RAY_CGRAPH_get_timeout=3000 --env MCCL_PROTOS=2 --env MCCL_CROSS_NIC=0 --env MCCL_SOCKET_IFNAME=bond0 --env MCCL_IB_GID_INDEX=3 --env MCCL_IB_TC=122 --env MCCL_IB_TIMEOUT=20 --env MCCL_IB_RETRY_CNT=7 --env MCCL_NET_SHARED_BUFFERS=0 --env GLOO_SOCKET_IFNAME=bond0 --shm-size=500g sh-harbor.mthreads.com/mcctest/vllm_musa:20251112_hygon bash
    ```
    
4.  单机推理不用仓库代码怎么命令行启动：
    
    1.  S4000：
        
        ```shell
        # 启动 vllm 服务, “注意” mla 模型 block_size 为 16, 非 mla 模型则为32
        vllm serve MODEL_PATH \
        --trust-remote-code \
        --gpu-memory-utilization 0.7 \
        --served-model-name qwen \
        --block-size 32 \
        --tensor-parallel-size 8 \
        --pipeline-parallel-size 1 \
        --max-num-seqs 30 \
        --compilation-config '{"cudagraph_capture_sizes": [1,2,3,4,5,6,7,8,10,12,14,16,18,20,24,28,30], "simple_cuda_graph": true}'
        ```
        
    2.  S5000：
        

```shell
# 如果不是 DeepSeek 模型， 需要加上环境变量：
# export VLLM_USE_V1=0
VLLM_USE_V1=0 vllm serve MODEL_PATH \
--trust-remote-code \
--gpu-memory-utilization 0.7 \
--served-model-name qwen \
--block-size 64 \
--tensor-parallel-size 8 \
--pipeline-parallel-size 1 \
--max-num-seqs 30 \
--compilation-config '{"cudagraph_capture_sizes": [1,2,3,4,5,6,7,8,10,12,14,16,18,20,24,28,30], "simple_cuda_graph": true}'
```

5.  容器环境验证执行 musaInfo 报错： /usr/lib/x86\_64-linux-gnu/libmusa.so: file too short
    
    ![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/ZWGl05m0ZY0G1n34/img/26b30a20-df18-4ca9-9a04-0f5f335c57e3.png)
    
    将宿主机对应文件拷贝到容器对应位置： docker cp /usr/lib/x86\_64-linux-gnu/libmusa.so.4.3.1 vllm\_musa\_2:/usr/lib/x86\_64-linux-gnu
    
6.  容器内执行 mthreads-gmi 无输出: 
    

将 宿主机对应文档拷贝到容器中

```shell
 docker cp /usr/bin/mthreads-gmi vllm_musa_2:/usr/bin
```