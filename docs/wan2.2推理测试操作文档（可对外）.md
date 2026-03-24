# wan2.2推理测试操作文档（可对外）

# 环境

*   image：`registry.mthreads.com/public/torch2.7_wan2.2_infer:v1.0.1`
    
*   driver：3.3.3
    

```bash
# 查看驱动版本
mthreads-gmi

# 更新驱动
sudo dpkg -P musa # 卸载旧驱动
sudo dpkg -i xxx.deb  #  安装新驱动包
sudo reboot  # 重启加载驱动

```

# 起容器

```bash
docker run -itd   --name=wan2.2_inference   --env MTHREADS_VISIBLE_DEVICES=all   --shm-size=500g   --network=host   --privileged   --pid=host   -v /data:/data   --workdir /home/wan2.2  registry.mthreads.com/public/torch2.7_wan2.2_infer:v1.0.1 bash

docker exec -it wan2.2_inference bash
```

# 示例

*   模型下载：[Wan2.2-T2V-A14B](https://www.modelscope.cn/models/Wan-AI/Wan2.2-T2V-A14B)  
    
*   8卡
    

```bash
cd /home/wan2.2

# 自行配置ckpt_dir 
torchrun --nproc_per_node=8 generate.py --task t2v-A14B --size 720*1280 --frame_num 81 --ckpt_dir /data/Wan2.2-T2V-A14B/ --dit_fsdp --t5_fsdp --ulysses_size 8 --prompt "构建一个山水画视频" --use_paravae
```